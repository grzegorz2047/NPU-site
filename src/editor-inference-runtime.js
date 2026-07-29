import { InferenceBenchmark } from './editor-inference-benchmark.js';
import { InferenceQueue } from './editor-inference-queue.js';
import { ModelRegistry, modelCacheKey } from './editor-model-registry.js';
import { VersionedModelCache } from './editor-model-cache.js';
import { runTiledInference } from './editor-tiling.js';

export class ImageInferenceRuntime {
  constructor({ registry = new ModelRegistry(), cache = new VersionedModelCache(), queue = new InferenceQueue(), adapters = {}, capabilities = detectInferenceCapabilities, now } = {}) {
    this.registry = registry;
    this.cache = cache;
    this.queue = queue;
    this.adapters = new Map(Object.entries(adapters));
    this.capabilityProvider = capabilities;
    this.now = now;
    this.sessions = new Map();
    this.listeners = new Set();
    this.lastReport = null;
    this.queue.subscribe(event => this.emit('queue', event));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  capabilities() {
    return normalizeCapabilities(typeof this.capabilityProvider === 'function' ? this.capabilityProvider() : this.capabilityProvider);
  }

  compatibilityMatrix() {
    return this.registry.compatibilityMatrix(this.capabilities());
  }

  async initialize({ modelId, mode = 'auto', signal, onProgress = () => {}, metadata = {} }) {
    const model = this.registry.get(modelId);
    const benchmark = new InferenceBenchmark({ now: this.now, metadata: { modelId, modelVersion: model.version, requestedMode: mode, initialization: true, ...metadata } });
    const candidates = this.registry.resolveCandidates(modelId, mode, this.capabilities());
    const failures = [];
    for (const backend of candidates) {
      try {
        const session = await this.getSession(model, backend, { signal, benchmark, onProgress });
        const report = benchmark.report({ actualBackend: backend, initialization: true });
        this.emit('initialized', { model, backend, report, ioBinding: Boolean(session.ioBinding) });
        return { model, backend, report, ioBinding: Boolean(session.ioBinding) };
      } catch (error) {
        failures.push({ backend, error });
        await this.releaseSession(model.id, backend);
        if (mode !== 'auto' || error?.name === 'AbortError') throw error;
      }
    }
    throw new Error(failures.map(item => `${item.backend}: ${item.error instanceof Error ? item.error.message : String(item.error)}`).join(' | '));
  }

  enqueue({ modelId, input, mode = 'auto', priority = 0, preview = false, tiled = null, metadata = {}, onProgress = () => {} }) {
    const taskId = metadata.taskId ?? `${modelId}-${Date.now().toString(36)}`;
    return this.queue.enqueue(async ({ signal, reportProgress }) => this.run({
      modelId,
      input,
      mode,
      preview,
      tiled,
      signal,
      metadata,
      onProgress: progress => {
        reportProgress(progress);
        onProgress(progress);
      }
    }), { id: taskId, priority, metadata: { modelId, mode, preview, ...metadata } });
  }

  async run({ modelId, input, mode = 'auto', preview = false, tiled = null, signal, metadata = {}, onProgress = () => {} }) {
    const model = this.registry.get(modelId);
    const benchmark = new InferenceBenchmark({ now: this.now, metadata: { modelId, modelVersion: model.version, requestedMode: mode, preview, ...metadata } });
    const candidates = this.registry.resolveCandidates(modelId, mode, this.capabilities());
    const failures = [];
    for (const backend of candidates) {
      try {
        const session = await this.getSession(model, backend, { signal, benchmark, onProgress });
        const result = tiled
          ? await this.runTiled(session, model, input, tiled, { signal, benchmark, onProgress })
          : await this.runSingle(session, model, input, { signal, benchmark, onProgress, preview });
        this.lastReport = benchmark.report({ actualBackend: backend, fallbackUsed: backend !== candidates[0] });
        const payload = { model, backend, result, benchmark: this.lastReport };
        this.emit('completed', payload);
        return payload;
      } catch (error) {
        failures.push({ backend, error });
        await this.releaseSession(model.id, backend);
        if (mode !== 'auto' || error?.name === 'AbortError') throw error;
      }
    }
    const message = failures.map(item => `${item.backend}: ${item.error instanceof Error ? item.error.message : String(item.error)}`).join(' | ');
    throw new Error(message || `Nie udało się uruchomić modelu ${model.name}.`);
  }

  async runSingle(session, model, input, { signal, benchmark, onProgress, preview }) {
    throwIfAborted(signal);
    const prepared = await benchmark.measure('preprocessing', () => session.preprocess ? session.preprocess(input, { model, preview, signal }) : input);
    throwIfAborted(signal);
    const transferred = await benchmark.measure('transfer-in', () => session.transferIn ? session.transferIn(prepared, { model, signal }) : prepared);
    onProgress({ stage: 'inference', label: preview ? 'Podgląd AI' : 'Inferencja', progress: 45 });
    const raw = await benchmark.measure('inference', () => session.run(transferred, { model, signal, preview }));
    throwIfAborted(signal);
    const received = await benchmark.measure('transfer-out', () => session.transferOut ? session.transferOut(raw, { model, signal }) : raw);
    const result = await benchmark.measure('postprocessing', () => session.postprocess ? session.postprocess(received, { model, input, preview, signal }) : received);
    onProgress({ stage: 'postprocessing', label: 'Gotowe', progress: 100 });
    return result;
  }

  async runTiled(session, model, input, options, { signal, benchmark, onProgress }) {
    const width = options.width ?? input.width;
    const height = options.height ?? input.height;
    if (!width || !height) throw new Error('Inferencja kafelkowa wymaga wymiarów obrazu.');
    const channels = options.channels ?? 1;
    return benchmark.measure('postprocessing', async () => runTiledInference({
      width,
      height,
      tileSize: options.tileSize,
      overlap: options.overlap,
      channels,
      signal,
      onProgress,
      extractTile: options.extractTile,
      inferTile: async (tileInput, tile) => {
        const payload = await this.runSingle(session, model, tileInput, { signal, benchmark, onProgress: () => {}, preview: false });
        return options.mapOutput ? options.mapOutput(payload, tile) : payload;
      }
    }));
  }

  async getSession(model, backend, { signal, benchmark, onProgress }) {
    const key = modelCacheKey(model, backend);
    if (this.sessions.has(key)) return this.sessions.get(key);
    const factory = this.adapters.get(backend);
    if (typeof factory !== 'function') throw new Error(`Brak adaptera backendu ${backend}.`);
    const adapter = await factory({ model, backend, cache: this.cache, signal, benchmark, onProgress });
    if (!adapter || typeof adapter.run !== 'function') throw new Error(`Adapter ${backend} nie zwrócił prawidłowej sesji.`);
    this.sessions.set(key, adapter);
    this.emit('session', { type: 'created', modelId: model.id, backend, ioBinding: Boolean(adapter.ioBinding) });
    return adapter;
  }

  async releaseSession(modelId, backend) {
    const model = this.registry.get(modelId);
    const key = modelCacheKey(model, backend);
    const session = this.sessions.get(key);
    if (!session) return false;
    this.sessions.delete(key);
    await session.dispose?.();
    this.emit('session', { type: 'released', modelId, backend });
    return true;
  }

  async dispose() {
    this.queue.cancelAll('Runtime został zamknięty.');
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(session => session.dispose?.()));
    this.emit('disposed', {});
  }

  diagnostics() {
    return {
      capabilities: this.capabilities(),
      compatibility: this.compatibilityMatrix(),
      sessions: [...this.sessions.keys()],
      queue: this.queue.snapshot(),
      lastReport: this.lastReport
    };
  }

  emit(type, detail) {
    const event = { type, detail, runtime: this };
    for (const listener of this.listeners) listener(event);
  }
}

export function detectInferenceCapabilities(scope = globalThis) {
  return {
    npu: Boolean(scope.navigator?.ml?.createContext),
    webgpu: Boolean(scope.navigator?.gpu),
    wasm: Boolean(scope.WebAssembly)
  };
}

function normalizeCapabilities(value = {}) {
  return { npu: Boolean(value.npu ?? value.webnn), webgpu: Boolean(value.webgpu), wasm: Boolean(value.wasm) };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException(String(signal.reason || 'Operacja anulowana.'), 'AbortError');
}
