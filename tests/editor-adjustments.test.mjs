import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJUSTMENT_TYPES,
  AdjustmentPresetStore,
  HSL_RANGES,
  applyAdjustmentStack,
  applyAdjustmentToRgba,
  buildCurveLut,
  computeHistogram,
  createAdjustment,
  normalizeAdjustment
} from '../src/editor-adjustments.js';
import { blendAdjustmentPixels, isAdjustmentLayer } from '../src/editor-adjustment-renderer.js';
import { createEditorDocument, createGroupLayer, createLayerMask } from '../src/editor-document.js';
import { CommandHistory, updateLayerCommand } from '../src/editor-history.js';

const rgba = (...pixels) => new Uint8ClampedArray(pixels.flat());
const pixel = (data, index = 0) => [...data.slice(index * 4, index * 4 + 4)];

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test('all adjustment schemas create neutral serializable descriptors', () => {
  const source = rgba([12, 80, 190, 255], [240, 120, 35, 180]);
  for (const type of ADJUSTMENT_TYPES) {
    const descriptor = createAdjustment(type);
    assert.equal(descriptor.type, type);
    assert.equal(descriptor.version, 1);
    assert.deepEqual(applyAdjustmentToRgba(source, 2, 1, descriptor), source, `${type} should be neutral by default`);
    assert.doesNotThrow(() => JSON.stringify(descriptor));
  }
});

test('normalization clamps invalid fields and restores nested defaults', () => {
  const exposure = normalizeAdjustment({ type: 'exposure', parameters: { exposure: 99, gamma: 0, contrast: -999 } });
  assert.equal(exposure.parameters.exposure, 5);
  assert.equal(exposure.parameters.gamma, 0.1);
  assert.equal(exposure.parameters.contrast, -100);
  const levels = normalizeAdjustment({ type: 'levels', parameters: { channels: { red: { inputBlack: 250, inputWhite: 20 } } } });
  assert.ok(levels.parameters.channels.red.inputBlack < levels.parameters.channels.red.inputWhite);
  assert.equal(levels.parameters.channels.green.gamma, 1);
  const hsl = normalizeAdjustment({ type: 'hsl', parameters: { ranges: { blue: { hue: 900 } } } });
  assert.equal(hsl.parameters.ranges.blue.hue, 180);
  assert.deepEqual(Object.keys(hsl.parameters.ranges), HSL_RANGES);
});

test('exposure brightness contrast and gamma produce stable tonal changes', () => {
  const source = rgba([64, 128, 192, 255]);
  const brighter = applyAdjustmentToRgba(source, 1, 1, createAdjustment('exposure', { exposure: 1 }));
  assert.ok(brighter[0] > source[0]);
  assert.ok(brighter[1] > source[1]);
  const contrast = applyAdjustmentToRgba(source, 1, 1, createAdjustment('exposure', { contrast: 30 }));
  assert.ok(contrast[0] < source[0]);
  assert.ok(contrast[2] > source[2]);
  const gamma = applyAdjustmentToRgba(source, 1, 1, createAdjustment('exposure', { gamma: 2 }));
  assert.ok(gamma[0] > source[0]);
  assert.equal(gamma[3], 255);
});

test('levels apply master and per-channel mappings in order', () => {
  const source = rgba([80, 80, 80, 255]);
  const descriptor = createAdjustment('levels');
  descriptor.parameters.channels.rgb.inputBlack = 40;
  descriptor.parameters.channels.red.outputBlack = 100;
  const output = applyAdjustmentToRgba(source, 1, 1, descriptor);
  assert.ok(output[0] > output[1]);
  assert.equal(output[1], output[2]);
});

test('curve LUT is identity by default and honors control points', () => {
  const identity = buildCurveLut();
  for (let value = 0; value < 256; value += 1) assert.equal(identity[value], value);
  const lifted = buildCurveLut([[0, 0], [128, 200], [255, 255]]);
  assert.ok(lifted[128] >= 199);
  assert.ok(lifted[64] > 64);
  const descriptor = createAdjustment('curves');
  descriptor.parameters.channels.red = [[0, 0], [128, 220], [255, 255]];
  const output = applyAdjustmentToRgba(rgba([128, 128, 128, 255]), 1, 1, descriptor);
  assert.ok(output[0] > output[1]);
});

test('white balance, HSL and color controls target chroma without changing alpha', () => {
  const source = rgba([40, 100, 210, 123]);
  const warm = applyAdjustmentToRgba(source, 1, 1, createAdjustment('white-balance', { temperature: 60, tint: 15 }));
  assert.ok(warm[0] > source[0]);
  assert.ok(warm[2] < source[2]);
  assert.equal(warm[3], 123);
  const hsl = createAdjustment('hsl');
  hsl.parameters.ranges.blue.saturation = -100;
  const desaturatedBlue = applyAdjustmentToRgba(source, 1, 1, hsl);
  assert.ok(Math.abs(desaturatedBlue[0] - desaturatedBlue[2]) < Math.abs(source[0] - source[2]));
  const monochrome = applyAdjustmentToRgba(source, 1, 1, createAdjustment('color', { saturation: -100 }));
  assert.equal(monochrome[0], monochrome[1]);
  assert.equal(monochrome[1], monochrome[2]);
});

test('tone, detail and finish effects are deterministic and preserve dimensions', () => {
  const source = rgba(
    [20, 20, 20, 255], [80, 80, 80, 255], [180, 180, 180, 255],
    [60, 90, 120, 255], [100, 130, 160, 255], [220, 220, 220, 255],
    [10, 40, 70, 255], [120, 150, 180, 255], [250, 250, 250, 255]
  );
  const tone = applyAdjustmentToRgba(source, 3, 3, createAdjustment('tone', { shadows: 50, highlights: -30, clarity: 20, dehaze: 15 }));
  assert.equal(tone.length, source.length);
  assert.ok(tone[0] > source[0]);
  const detail = applyAdjustmentToRgba(source, 3, 3, createAdjustment('detail', { sharpen: 40, blur: 0.5 }));
  assert.equal(detail.length, source.length);
  assert.notDeepEqual(detail, source);
  const finish = createAdjustment('finish', { vignette: 40, grain: 20, grainSeed: 42 });
  const first = applyAdjustmentToRgba(source, 3, 3, finish);
  const second = applyAdjustmentToRgba(source, 3, 3, finish);
  assert.deepEqual(first, second);
  assert.ok(first[0] < source[0]);
});

test('adjustment stack order changes the result', () => {
  const source = rgba([90, 130, 180, 255]);
  const exposure = createAdjustment('exposure', { brightness: 25, contrast: 40 });
  const levels = createAdjustment('levels');
  levels.parameters.channels.rgb.inputBlack = 60;
  const first = applyAdjustmentStack(source, 1, 1, [exposure, levels]);
  const second = applyAdjustmentStack(source, 1, 1, [levels, exposure]);
  assert.notDeepEqual(first, second);
});

test('histogram reports RGB luminance and clipping ratios', () => {
  const source = rgba([0, 0, 0, 255], [255, 255, 255, 255], [255, 0, 0, 255], [10, 20, 30, 0]);
  const histogram = computeHistogram(source, { bins: 256, maxSamples: 100 });
  assert.equal(histogram.samples, 3);
  assert.equal(histogram.channels.red[255], 2);
  assert.equal(histogram.channels.green[0], 2);
  assert.equal(histogram.clippedShadows, 1);
  assert.equal(histogram.clippedHighlights, 1);
  assert.equal(histogram.shadowRatio, 1 / 3);
  assert.equal(histogram.highlightRatio, 1 / 3);
});

test('preset store keeps built-ins and persists custom presets', () => {
  const storage = new MemoryStorage();
  const store = new AdjustmentPresetStore({ storage, key: 'test-presets' });
  const builtInCount = store.list().length;
  const saved = store.save('My look', createAdjustment('exposure', { exposure: 0.4 }));
  assert.equal(store.list().length, builtInCount + 1);
  assert.equal(store.get(saved.id).parameters.exposure, 0.4);
  const restored = new AdjustmentPresetStore({ storage, key: 'test-presets' });
  assert.equal(restored.get(saved.id).name, 'My look');
  assert.equal(restored.remove(saved.id), true);
  assert.equal(restored.get(saved.id), null);
});

test('renderer blending respects opacity mask blend mode and transparent pixels', () => {
  const original = rgba([100, 120, 140, 255], [50, 60, 70, 0]);
  const adjusted = rgba([200, 220, 240, 255], [255, 255, 255, 0]);
  const half = blendAdjustmentPixels(original, adjusted, { opacity: 0.5, mask: new Float32Array([1, 1]) });
  assert.deepEqual(pixel(half), [150, 170, 190, 255]);
  assert.deepEqual(pixel(half, 1), [50, 60, 70, 0]);
  const masked = blendAdjustmentPixels(original, adjusted, { opacity: 1, mask: new Float32Array([0.25, 0]) });
  assert.deepEqual(pixel(masked), [125, 145, 165, 255]);
  const multiply = blendAdjustmentPixels(rgba([128, 128, 128, 255]), rgba([128, 64, 255, 255]), { blendMode: 'multiply' });
  assert.deepEqual(pixel(multiply), [64, 32, 128, 255]);
  assert.throws(() => blendAdjustmentPixels(original, adjusted, { mask: new Float32Array(1) }), /Maska/);
});

test('adjustment layers are identified through serializable metadata', () => {
  const layer = {
    type: 'group',
    metadata: { kind: 'adjustment', adjustment: createAdjustment('exposure') },
    children: []
  };
  assert.equal(isAdjustmentLayer(layer), true);
  assert.equal(isAdjustmentLayer({ type: 'group', metadata: {}, children: [] }), false);
  assert.doesNotThrow(() => JSON.stringify(layer));
});

test('adjustment layers survive document serialization and parameter undo redo', () => {
  const layer = createGroupLayer({
    id: 'adjustment',
    name: 'Ekspozycja',
    metadata: { kind: 'adjustment', adjustment: createAdjustment('exposure', { exposure: 0.25 }) },
    mask: createLayerMask({ enabled: true, opacity: 0.8, metadata: { mode: 'full' } }),
    children: []
  });
  const documentModel = createEditorDocument({ width: 8, height: 6, layers: [layer], activeLayerId: layer.id });
  const history = new CommandHistory();
  const next = createAdjustment('exposure', { exposure: 1.5, contrast: 20 });
  history.execute(updateLayerCommand(layer.id, { metadata: { adjustment: next } }, { label: 'Zmień korektę' }), documentModel);
  assert.equal(documentModel.getLayer(layer.id).metadata.adjustment.parameters.exposure, 1.5);
  history.undo(documentModel);
  assert.equal(documentModel.getLayer(layer.id).metadata.adjustment.parameters.exposure, 0.25);
  history.redo(documentModel);
  assert.equal(documentModel.getLayer(layer.id).metadata.adjustment.parameters.contrast, 20);

  const serialized = JSON.parse(JSON.stringify(documentModel));
  const restored = createEditorDocument(serialized);
  assert.equal(isAdjustmentLayer(restored.getLayer(layer.id)), true);
  assert.equal(restored.getLayer(layer.id).mask.opacity, 0.8);
  assert.equal(restored.getLayer(layer.id).metadata.adjustment.parameters.exposure, 1.5);
});
