import test from 'node:test';
import assert from 'node:assert/strict';
import { combineMasks, connectedComponents, maskBounds, maskContains, normalizeMask, paintMask, refineMask, scaleMask } from '../src/editor-smart-mask.js';
import { combineSelectedObjects, createPersonObjectFromMask, hitTestSmartObjects, mergeSmartObjects, normalizeDetections, normalizeSemanticSegments, normalizeSmartCategory } from '../src/editor-smart-objects.js';
import { SMART_DETECTION_MODEL_ID, SMART_SEGMENTATION_MODEL_ID, SmartSelectEngine, registerSmartSelectModels } from '../src/editor-smart-select-engine.js';
import { applySmartMaskToLayer, convertDocumentMaskToLayerSpace, isLayerLocalSmartMask, transformLocalMaskPoint } from '../src/editor-smart-mask-renderer.js';
import { ModelRegistry } from '../src/editor-model-registry.js';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { CommandHistory } from '../src/editor-history.js';

test('normalizes and scales masks', () => {
  const source = new Float32Array([0, 1, 1, 0]);
  assert.deepEqual([...normalizeMask(source, 2, 2)], [0, 255, 255, 0]);
  const scaled = scaleMask(source, 2, 2, 4, 4);
  assert.equal(scaled.length, 16);
  assert.equal(scaled[0], 0);
  assert.equal(scaled[3], 255);
  assert.ok(scaled.some(value => value > 0 && value < 255));
});

test('combines masks and finds connected objects', () => {
  const a = Uint8Array.from([255, 255, 0, 0]);
  const b = Uint8Array.from([0, 255, 255, 0]);
  assert.deepEqual([...combineMasks([a, b], 4, 1, 'union')], [255, 255, 255, 0]);
  assert.deepEqual([...combineMasks([a, b], 4, 1, 'intersect')], [0, 255, 0, 0]);
  const source = new Uint8Array(25);
  for (const index of [0, 1, 5, 6, 18, 19, 23, 24, 12]) source[index] = 255;
  const components = connectedComponents(source, 5, 5, { minPixels: 2 });
  assert.equal(components.length, 2);
  assert.equal(maskBounds(components[0], 5, 5).pixels, 4);
});

test('refine edge and manual brush alter masks deterministically', () => {
  const source = new Uint8Array(49); source[24] = 255;
  const expanded = refineMask(source, 7, 7, { expand: 1, threshold: 0.1, softness: 0.05 });
  assert.ok(maskBounds(expanded, 7, 7).pixels >= 5);
  const painted = paintMask(new Uint8Array(400), 20, 20, [{ x: 10, y: 10, pressure: 1 }], { mode: 'add', size: 8, hardness: 1 });
  assert.equal(maskContains(painted, 20, 20, 10, 10), true);
  const erased = paintMask(painted, 20, 20, [{ x: 10, y: 10, pressure: 1 }], { mode: 'subtract', size: 4, hardness: 1 });
  assert.equal(maskContains(erased, 20, 20, 10, 10), false);
});

test('maps required semantic categories', () => {
  assert.equal(normalizeSmartCategory('person'), 'person');
  assert.equal(normalizeSmartCategory('sports car'), 'car');
  assert.equal(normalizeSmartCategory('sky'), 'sky');
  assert.equal(normalizeSmartCategory('tree'), 'vegetation');
  assert.equal(normalizeSmartCategory('laptop'), 'product');
  assert.equal(normalizeSmartCategory('wall'), 'other');
});

test('normalizes, merges and hit-tests semantic objects', () => {
  const semanticData = Uint8Array.from(Array.from({ length: 48 }, (_, index) => {
    const x = index % 8; const y = Math.floor(index / 8);
    return x >= 2 && x <= 5 && y >= 2 && y <= 4 ? 255 : 0;
  }));
  const semantic = normalizeSemanticSegments([{ label: 'car', score: 0.7, mask: { width: 8, height: 6, data: semanticData } }], 8, 6, { minPixels: 2 });
  const detections = normalizeDetections([{ label: 'car', score: 0.9, box: { xmin: 1, ymin: 1, xmax: 7, ymax: 6 } }], 8, 6);
  const merged = mergeSmartObjects(detections, semantic, { iouThreshold: 0.1 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'detection+semantic');
  assert.equal(hitTestSmartObjects(merged, 3, 3)[0].id, merged[0].id);
});

test('combines selected person and car masks', () => {
  const personMask = new Uint8Array(16); personMask[5] = personMask[6] = personMask[9] = personMask[10] = 255;
  const person = createPersonObjectFromMask(personMask, 4, 4);
  const car = normalizeDetections([{ label: 'car', score: 1, box: { xmin: 0, ymin: 0, xmax: 2, ymax: 2 } }], 4, 4)[0];
  const combined = combineSelectedObjects([person, car], [person.id, car.id], 4, 4);
  assert.equal(maskContains(combined, 4, 4, 0, 0), true);
  assert.equal(maskContains(combined, 4, 4, 2, 2), true);
});

test('registers models and rejects unverified NPU-only contracts', () => {
  const registry = registerSmartSelectModels(new ModelRegistry());
  assert.equal(registry.get(SMART_SEGMENTATION_MODEL_ID).task, 'image-segmentation');
  assert.equal(registry.get(SMART_DETECTION_MODEL_ID).task, 'object-detection');
  assert.throws(() => registry.resolveCandidates(SMART_SEGMENTATION_MODEL_ID, 'npu', { npu: true, webgpu: true, wasm: true }), /NPU/);
  assert.deepEqual(registry.resolveCandidates(SMART_DETECTION_MODEL_ID, 'auto', { npu: true, webgpu: true, wasm: true }), ['webgpu', 'wasm']);
});

test('uses one queued runtime for segmentation, detection and MODNet', async () => {
  const registry = registerSmartSelectModels(new ModelRegistry());
  const calls = [];
  const runtime = {
    registry,
    enqueue(options) {
      calls.push(options.modelId);
      const result = options.modelId === SMART_SEGMENTATION_MODEL_ID
        ? [{ label: 'sky', score: 0.8, mask: { width: 2, height: 2, data: Uint8Array.from([255, 255, 0, 0]) } }]
        : options.modelId === SMART_DETECTION_MODEL_ID
          ? [{ label: 'car', score: 0.9, box: { xmin: 0, ymin: 1, xmax: 2, ymax: 2 } }]
          : Float32Array.from([0, 1, 1, 0]);
      return { cancel: () => true, promise: Promise.resolve({ result, benchmark: { metadata: { modelId: options.modelId, actualBackend: options.modelId === 'modnet-portrait-matting' ? 'npu' : 'webgpu' }, totalDurationMs: 5 } }) };
    },
    diagnostics() { return {}; }
  };
  const engine = new SmartSelectEngine({ runtime, registry, previewFactory: value => value });
  const analysis = await engine.analyze({ width: 2, height: 2 }, { width: 4, height: 4 });
  assert.deepEqual(calls, [SMART_SEGMENTATION_MODEL_ID, SMART_DETECTION_MODEL_ID, 'modnet-portrait-matting']);
  assert.ok(analysis.objects.some(object => object.category === 'person' && object.source === 'modnet'));
  assert.ok(analysis.objects.some(object => object.category === 'sky'));
  assert.ok(analysis.objects.some(object => object.category === 'car'));
});

test('converts a document mask to layer space so it follows transforms', () => {
  const documentMask = new Uint8Array(100); documentMask[6 * 10 + 7] = 255;
  const transform = { x: 2, y: 1, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, originX: 0, originY: 0 };
  const local = convertDocumentMaskToLayerSpace(documentMask, 10, 10, transform);
  assert.equal(maskContains(local, 10, 10, 5, 5), true);
  assert.deepEqual(transformLocalMaskPoint({ x: 5, y: 5 }, transform), { x: 7, y: 6 });
});

test('applies a smart mask as one undo redo operation', () => {
  const layer = createRasterLayer({ id: 'base', assetId: 'asset', width: 4, height: 4, transform: { x: 1, y: 0 } });
  const documentModel = createEditorDocument({ width: 4, height: 4, layers: [layer], activeLayerId: layer.id });
  const history = new CommandHistory();
  const values = new Uint8Array(16); values[5] = 255;
  applySmartMaskToLayer({ documentModel, history, renderer: { render() {} }, layerId: layer.id, mask: values, width: 4, height: 4 });
  assert.equal(isLayerLocalSmartMask(documentModel.getLayer(layer.id)), true);
  assert.equal(history.undoStack.length, 1);
  history.undo(documentModel);
  assert.equal(documentModel.getLayer(layer.id).mask, null);
  history.redo(documentModel);
  assert.equal(documentModel.getLayer(layer.id).mask.metadata.coordinateSpace, 'layer');
});
