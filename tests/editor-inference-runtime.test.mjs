import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageInferenceRuntime } from '../src/editor-inference-runtime.js';
import { InferenceQueue } from '../src/editor-inference-queue.js';
import { VersionedModelCache } from '../src/editor-model-cache.js';
import { BUILTIN_IMAGE_MODELS, ModelRegistry, modelCacheKey } from '../src/editor-model-registry.js';
import { createTilePlan, runTiledInference, stitchNumericTiles } from '../src/editor-tiling.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRegistry() {
  return new ModelRegistry([
    {
      id: 'mask-model', name: 'Mask', version: '1', license: 'test', task: 'mask',
      inputs: [{ name: 'image' }], outputs: [{ name: 'mask' }], preprocessing: {}, artifacts: {},
      compatibility: { npu: true, webgpu: true, wasm: true }
    },
    {
      id: 'depth-model', name: 'Depth', version: '2', license: 'test', task: 'depth',
      inputs: [{ name: 'image' }], outputs: [{ name: 'depth' }], preprocessing: {}, artifacts: {},
      compatibility: { npu: false, webgpu: true, wasm: true }
    }
  ]);
}

function session(tag, counters) {
  counters.created.push(tag);
  return {
    ioBinding: tag === 'npu',
    preprocess: value => value + 1,
    transferIn: value => value + 1,
    run: value => { counters.runs.push(tag); return value + 1; },
    transferOut: value => value + 1,
    postprocess: value => ({ tag, value: value + 1 }),
    dispose: () => counters.disposed.push(tag)
  };
}

function response(bytes) {
  return new Response(Uint8Array.from(bytes), { status: 200, headers: { 'content-length': String(bytes.length) } });
}

test('registers two production image models with complete contracts', () => {
  const registry = new ModelRegistry();
  assert.equal(registry.list().length, 2);
  for (const model of registry.list()) {
    assert.ok(model.id);
    assert.ok(model.version);
    assert.ok(model.license);
    assert.ok(model.inputs.length);
    assert.ok(model.outputs.length);
    assert.ok(Object.values(model.compatibility).some(item => item.supported));
    assert.throws(() => { model.name = 'changed'; }, TypeError);
  }
  assert.equal(BUILTIN_IMAGE_MODELS[0].task, 'background-removal');
  assert.equal(BUILTIN_IMAGE_MODELS[1].task, 'depth-estimation');
});

test('resolves auto backends in NPU, WebGPU, WASM order and keeps NPU strict', () => {
  const registry = new ModelRegistry();
  const caps = { npu: true, webgpu: true, wasm: true };
  assert.deepEqual(registry.resolveCandidates('modnet-portrait-matting', 'auto', caps), ['npu', 'webgpu', 'wasm']);
  assert.deepEqual(registry.resolveCandidates('modnet-portrait-matting', 'npu', caps), ['npu']);
  assert.throws(() => registry.resolveCandidates('depth-anything-v2-small', 'npu', caps), /Tylko NPU/);
});

test('builds a capability-aware compatibility matrix and versioned cache keys', () => {
  const registry = new ModelRegistry();
  const matrix = registry.compatibilityMatrix({ npu: false, webgpu: true, wasm: true });
  const modnet = matrix.find(item => item.id === 'modnet-portrait-matting');
  assert.equal(modnet.backends.npu.available, false);
  assert.equal(modnet.backends.webgpu.available, true);
  assert.match(modelCacheKey(registry.get('modnet-portrait-matting'), 'webgpu'), /@.+:webgpu$/);
});

test('downloads a model once and reuses the versioned in-memory cache', async () => {
  let requests = 0;
  const progress = [];
  const cache = new VersionedModelCache({ cacheStorage: null, fetcher: async () => { requests += 1; return response([1, 2, 3]); } });
  const first = await cache.get('https://example.test/model', { key: 'model@1:npu', onProgress: event => progress.push(event) });
  const second = await cache.get('https://example.test/model', { key: 'model@1:npu' });
  assert.equal(requests, 1);
  assert.deepEqual([...first], [1, 2, 3]);
  assert.deepEqual([...second], [1, 2, 3]);
  first[0] = 9;
  assert.equal(second[0], 1);
  assert.equal(progress.at(-1).progress, 100);
});

test('keeps model versions isolated and supports explicit clearing', async () => {
  let requests = 0;
  const cache = new VersionedModelCache({ cacheStorage: null, fetcher: async () => response([++requests]) });
  assert.equal((await cache.get('u', { key: 'model@1:wasm' }))[0], 1);
  assert.equal((await cache.get('u', { key: 'model@2:wasm' }))[0], 2);
  await cache.clear();
  assert.equal((await cache.get('u', { key: 'model@1:wasm' }))[0], 3);
});

test('runs queued work by priority while preserving FIFO for equal priority', async () => {
  const queue = new InferenceQueue({ concurrency: 1 });
  const order = [];
  const blocker = queue.enqueue(async () => { await delay(15); order.push('blocker'); }, { id: 'blocker' });
  const low = queue.enqueue(async () => { order.push('low'); }, { id: 'low', priority: 1 });
  const highA = queue.enqueue(async () => { order.push('high-a'); }, { id: 'high-a', priority: 10 });
  const highB = queue.enqueue(async () => { order.push('high-b'); }, { id: 'high-b', priority: 10 });
  await Promise.all([blocker.promise, low.promise, highA.promise, highB.promise]);
  assert.deepEqual(order, ['blocker', 'high-a', 'high-b', 'low']);
});

test('reports progress and cancels pending and running tasks', async () => {
  const queue = new InferenceQueue({ concurrency: 1 });
  const events = [];
  queue.subscribe(event => events.push(event.type));
  const running = queue.enqueue(async ({ signal, reportProgress }) => {
    reportProgress({ progress: 20 });
    while (!signal.aborted) await delay(2);
    throw new DOMException('cancelled', 'AbortError');
  }, { id: 'running' });
  const pending = queue.enqueue(async () => 'never', { id: 'pending' });
  assert.equal(queue.cancel('pending'), true);
  assert.equal(queue.cancel('running'), true);
  await assert.rejects(pending.promise, { name: 'AbortError' });
  await assert.rejects(running.promise, { name: 'AbortError' });
  assert.ok(events.includes('progress'));
  assert.equal(queue.snapshot().pending.length, 0);
  assert.equal(queue.snapshot().running.length, 0);
});

test('creates overlapping tiles that cover every source pixel', () => {
  const plan = createTilePlan(1000, 730, { tileSize: 256, overlap: 32 });
  assert.equal(plan.tiles[0].x, 0);
  assert.equal(plan.tiles[0].y, 0);
  assert.equal(plan.tiles.at(-1).x + plan.tiles.at(-1).width, 1000);
  assert.equal(plan.tiles.at(-1).y + plan.tiles.at(-1).height, 730);
  assert.ok(plan.tiles.length > 1);
  assert.throws(() => createTilePlan(100, 100, { tileSize: 64, overlap: 32 }), /Overlap/);
});

test('blends overlaps without seams for identical source values', () => {
  const plan = createTilePlan(17, 11, { tileSize: 8, overlap: 2 });
  const outputs = plan.tiles.map(tile => {
    const values = new Float32Array(tile.width * tile.height);
    for (let y = 0; y < tile.height; y += 1) {
      for (let x = 0; x < tile.width; x += 1) values[y * tile.width + x] = tile.x + x + (tile.y + y) * 100;
    }
    return values;
  });
  const stitched = stitchNumericTiles(plan, outputs);
  for (let y = 0; y < plan.height; y += 1) {
    for (let x = 0; x < plan.width; x += 1) assert.ok(Math.abs(stitched[y * plan.width + x] - (x + y * 100)) < 1e-4);
  }
});

test('runs tiled inference with progress and supports cancellation', async () => {
  const progress = [];
  const result = await runTiledInference({
    width: 9,
    height: 7,
    tileSize: 5,
    overlap: 1,
    channels: 1,
    extractTile: tile => tile,
    inferTile: tile => new Float32Array(tile.width * tile.height).fill(tile.index + 1),
    onProgress: event => progress.push(event.progress)
  });
  assert.equal(result.data.length, 63);
  assert.equal(progress.at(-1), 100);
  assert.ok(result.stitchDurationMs >= 0);

  const controller = new AbortController();
  controller.abort('stop');
  await assert.rejects(runTiledInference({
    width: 5,
    height: 5,
    tileSize: 5,
    overlap: 1,
    extractTile: tile => tile,
    inferTile: () => new Float32Array(25),
    signal: controller.signal
  }), { name: 'AbortError' });
});

test('runs two different models through one API and reuses sessions', async () => {
  const counters = { created: [], runs: [], disposed: [] };
  const runtime = new ImageInferenceRuntime({
    registry: createRegistry(),
    capabilities: () => ({ npu: true, webgpu: true, wasm: true }),
    adapters: {
      npu: async () => session('npu', counters),
      webgpu: async () => session('webgpu', counters),
      wasm: async () => session('wasm', counters)
    },
    now: (() => { let value = 0; return () => ++value; })()
  });
  const mask = await runtime.run({ modelId: 'mask-model', input: 0, mode: 'auto' });
  const maskAgain = await runtime.run({ modelId: 'mask-model', input: 5, mode: 'auto' });
  const depth = await runtime.run({ modelId: 'depth-model', input: 10, mode: 'auto' });
  assert.equal(mask.backend, 'npu');
  assert.equal(mask.result.value, 5);
  assert.equal(maskAgain.backend, 'npu');
  assert.equal(depth.backend, 'webgpu');
  assert.deepEqual(counters.created, ['npu', 'webgpu']);
  assert.ok(mask.benchmark.stages.preprocessing.durationMs > 0);
  assert.ok(mask.benchmark.stages.inference.durationMs > 0);
  assert.equal(runtime.diagnostics().sessions.length, 2);
  assert.equal(runtime.diagnostics().sessionDetails.find(item => item.key.endsWith(':npu')).ioBinding, true);
  await runtime.dispose();
  assert.deepEqual(counters.disposed.sort(), ['npu', 'webgpu']);
});

test('auto mode falls back after a backend error but NPU-only never falls back', async () => {
  const runtime = new ImageInferenceRuntime({
    registry: createRegistry(),
    capabilities: () => ({ npu: true, webgpu: true, wasm: true }),
    adapters: {
      npu: async () => { throw new Error('operator unsupported'); },
      webgpu: async () => ({ run: value => value }),
      wasm: async () => ({ run: value => value })
    }
  });
  const initialized = await runtime.initialize({ modelId: 'mask-model', mode: 'auto' });
  assert.equal(initialized.backend, 'webgpu');
  assert.equal(runtime.diagnostics().lastReport.metadata.actualBackend, 'webgpu');
  const automatic = await runtime.run({ modelId: 'mask-model', input: 1, mode: 'auto' });
  assert.equal(automatic.backend, 'webgpu');
  await assert.rejects(runtime.run({ modelId: 'mask-model', input: 1, mode: 'npu' }), /operator unsupported/);
  await assert.rejects(runtime.run({ modelId: 'depth-model', input: 1, mode: 'npu' }), /Tylko NPU/);
});

test('queued inference exposes progress and can be cancelled', async () => {
  const runtime = new ImageInferenceRuntime({
    registry: createRegistry(),
    capabilities: () => ({ npu: false, webgpu: false, wasm: true }),
    adapters: {
      wasm: async () => ({
        run: async (_value, { signal }) => {
          while (!signal.aborted) await delay(2);
          throw new DOMException('cancelled', 'AbortError');
        }
      })
    }
  });
  const task = runtime.enqueue({ modelId: 'mask-model', input: 1, mode: 'wasm', metadata: { taskId: 'cancel-me' } });
  await delay(5);
  assert.equal(task.cancel(), true);
  await assert.rejects(task.promise, { name: 'AbortError' });
});
