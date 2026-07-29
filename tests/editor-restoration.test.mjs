import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESTORATION_PROFILES,
  normalizeRestorationOptions,
  createPreviewRegion,
  createScaledTilePlan,
  stitchScaledRgbaTiles,
  extractRgbaTile,
  applyLocalRestoration,
  denoiseRgba,
  differenceRgba,
  estimateRestorationMemory
} from '../src/editor-restoration-core.js';
import { createAddRestorationLayerCommand } from '../src/editor-restoration-commands.js';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { CommandHistory } from '../src/editor-history.js';

const solid = (width, height, rgba) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return data;
};

test('profiles cover four restoration tasks and normalize unsafe options', () => {
  const tasks = new Set(Object.values(RESTORATION_PROFILES).map(profile => profile.task));
  assert.deepEqual([...tasks].sort(), ['deblur', 'denoise', 'jpeg-restoration', 'super-resolution']);
  const options = normalizeRestorationOptions({ profileId: 'sr-4x-quality', strength: 4, overlap: -5, tileSize: 9999 });
  assert.equal(options.scale, 4);
  assert.equal(options.strength, 1);
  assert.equal(options.overlap, 0);
  assert.equal(options.tileSize, 1024);
});

test('preview uses selection bounds and stays within document', () => {
  assert.deepEqual(createPreviewRegion(1000, 600, { x: 900, y: 550, width: 200, height: 100 }), { x: 800, y: 500, width: 200, height: 100 });
  assert.deepEqual(createPreviewRegion(120, 80, null, { size: 256 }), { x: 0, y: 0, width: 120, height: 80 });
});

test('scaled tile plan maps overlap and output coordinates', () => {
  const plan = createScaledTilePlan(500, 300, { tileSize: 256, overlap: 32, scale: 2 });
  assert.equal(plan.outputWidth, 1000);
  assert.equal(plan.outputHeight, 600);
  assert.ok(plan.tiles.length > 1);
  assert.equal(plan.tiles[1].output.x, plan.tiles[1].x * 2);
  assert.equal(plan.tiles[1].output.crop.left, 64);
});

test('scaled tile stitch blends constant overlapping tiles without seams', () => {
  const plan = createScaledTilePlan(6, 2, { tileSize: 4, overlap: 1, scale: 2 });
  const outputs = plan.tiles.map(tile => ({ width: tile.output.width, height: tile.output.height, data: solid(tile.output.width, tile.output.height, [120, 80, 40, 255]) }));
  const stitched = stitchScaledRgbaTiles(plan, outputs);
  assert.equal(stitched.width, 12);
  assert.equal(stitched.height, 4);
  for (let index = 0; index < stitched.data.length; index += 4) assert.deepEqual([...stitched.data.slice(index, index + 4)], [120, 80, 40, 255]);
});

test('tile extraction preserves exact source pixels', () => {
  const source = new Uint8ClampedArray(4 * 3 * 4);
  for (let pixel = 0; pixel < 12; pixel += 1) source.set([pixel, pixel + 1, pixel + 2, 255], pixel * 4);
  const tile = extractRgbaTile(source, 4, 3, { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual([...tile.data.slice(0, 4)], [5, 6, 7, 255]);
  assert.deepEqual([...tile.data.slice(12, 16)], [10, 11, 12, 255]);
});

test('local super-resolution changes dimensions and preserves uniform color', () => {
  const source = solid(2, 2, [20, 40, 60, 255]);
  const result = applyLocalRestoration(source, 2, 2, { profileId: 'sr-2x-fast', sharpen: 0 });
  assert.equal(result.width, 4);
  assert.equal(result.height, 4);
  for (let i = 0; i < result.data.length; i += 4) assert.deepEqual([...result.data.slice(i, i + 4)], [20, 40, 60, 255]);
});

test('denoise reduces isolated noise and preserves alpha', () => {
  const source = solid(3, 3, [100, 100, 100, 255]);
  source.set([255, 0, 255, 123], 4 * 4);
  const result = denoiseRgba(source, 3, 3, 1);
  assert.ok(result[16] < 255);
  assert.ok(result[17] > 0);
  assert.equal(result[19], 123);
});

test('jpeg restoration and deblur are deterministic and retain size', () => {
  const source = solid(4, 4, [80, 100, 120, 255]);
  source.set([200, 210, 220, 255], 20);
  for (const profileId of ['jpeg-quality', 'deblur-local']) {
    const first = applyLocalRestoration(source, 4, 4, { profileId, strength: 0.7 });
    const second = applyLocalRestoration(source, 4, 4, { profileId, strength: 0.7 });
    assert.equal(first.width, 4);
    assert.equal(first.height, 4);
    assert.deepEqual(first.data, second.data);
  }
});

test('difference visualization amplifies RGB differences', () => {
  const before = new Uint8ClampedArray([10, 20, 30, 0]);
  const after = new Uint8ClampedArray([20, 10, 40, 255]);
  assert.deepEqual([...differenceRgba(before, after)], [40, 40, 40, 255]);
});

test('memory estimate accounts for output scale', () => {
  const one = estimateRestorationMemory(100, 50, { scale: 1, tileSize: 64 });
  const four = estimateRestorationMemory(100, 50, { scale: 4, tileSize: 64 });
  assert.equal(four.outputBytes, one.outputBytes * 16);
  assert.ok(four.peakBytes > four.outputBytes);
});

test('abort signal stops expensive local processing', () => {
  const controller = new AbortController();
  controller.abort('stop');
  assert.throws(() => applyLocalRestoration(solid(8, 8, [1, 2, 3, 255]), 8, 8, { profileId: 'denoise-local' }, controller.signal), error => error.name === 'AbortError');
});

test('result layer, document resize and history are atomic', () => {
  const base = createRasterLayer({ id: 'base', name: 'Bazowa', assetId: 'source', width: 2, height: 2 });
  const documentModel = createEditorDocument({ width: 2, height: 2, layers: [base], activeLayerId: base.id, selectedLayerIds: [base.id] });
  documentModel.setRuntimeAsset('source', { width: 2, height: 2 });
  const history = new CommandHistory();
  const result = {
    canvas: { width: 8, height: 8 },
    width: 8,
    height: 8,
    task: 'super-resolution',
    profileId: 'sr-4x-quality',
    backend: 'webgpu',
    modelId: 'swin2sr-realworld-x4',
    tileCount: 2,
    memory: { peakBytes: 1024 },
    benchmark: { totalMs: 12 }
  };
  history.execute(createAddRestorationLayerCommand(documentModel, result, { assetId: 'restored' }), documentModel);
  assert.equal(documentModel.width, 8);
  assert.equal(documentModel.height, 8);
  assert.equal(documentModel.layers.length, 2);
  assert.equal(documentModel.activeLayer.metadata.kind, 'restoration');
  assert.equal(documentModel.getRuntimeAsset('restored'), result.canvas);
  assert.equal(history.undo(documentModel), true);
  assert.equal(documentModel.width, 2);
  assert.equal(documentModel.layers.length, 1);
  assert.equal(history.redo(documentModel), true);
  assert.equal(documentModel.width, 8);
  assert.equal(documentModel.layers.length, 2);
  assert.equal(documentModel.activeLayer.metadata.modelId, 'swin2sr-realworld-x4');
});
