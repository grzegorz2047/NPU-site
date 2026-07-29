import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseSpotSourceOffset,
  createRetouchLayerMetadata,
  createRetouchStroke,
  isRetouchLayer,
  processRetouchStroke,
  resolveStrokeSourceOffset,
  retouchPatchBounds,
  retouchStampPlan,
  sourcePointForDestination
} from '../src/editor-retouch.js';
import { createAppendRetouchStrokeCommand } from '../src/editor-retouch-commands.js';
import { RetouchProcessor } from '../src/editor-retouch-processor.js';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { CommandHistory } from '../src/editor-history.js';
import { createProjectRecord, referencedAssetIds } from '../src/editor-project-format.js';

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = pixel(x, y);
    data.set(value, (y * width + x) * 4);
  }
  return data;
}

function patchPixel(result, documentX, documentY) {
  const x = documentX - result.bounds.x;
  const y = documentY - result.bounds.y;
  if (x < 0 || y < 0 || x >= result.bounds.width || y >= result.bounds.height) return [0, 0, 0, 0];
  const offset = (y * result.bounds.width + x) * 4;
  return [...result.data.slice(offset, offset + 4)];
}

test('resolves aligned, unaligned and automatic spot source offsets', () => {
  const source = { x: 20, y: 25 };
  const firstDestination = { x: 50, y: 60 };
  const initial = resolveStrokeSourceOffset({ tool: 'clone', aligned: true, sourcePoint: source, destinationStart: firstDestination });
  assert.deepEqual(initial, { x: -30, y: -35 });
  const reused = resolveStrokeSourceOffset({ tool: 'clone', aligned: true, sourcePoint: source, destinationStart: { x: 80, y: 90 }, alignedOffset: initial });
  assert.deepEqual(reused, initial);
  const reset = resolveStrokeSourceOffset({ tool: 'clone', aligned: false, sourcePoint: source, destinationStart: { x: 80, y: 90 }, alignedOffset: initial });
  assert.deepEqual(reset, { x: -60, y: -65 });
  const spot = resolveStrokeSourceOffset({ tool: 'spot-healing', destinationStart: { x: 10, y: 10 }, width: 120, height: 80, size: 20 });
  assert.notDeepEqual(spot, { x: 0, y: 0 });
  assert.deepEqual(spot, chooseSpotSourceOffset({ x: 10, y: 10 }, 120, 80, 20));
});

test('maps every destination point to the expected source point', () => {
  const stroke = createRetouchStroke([{ x: 30, y: 40 }], {
    tool: 'clone', sourceOffset: { x: -12, y: 7 }, size: 10
  });
  assert.deepEqual(sourcePointForDestination(stroke, { x: 90, y: 22 }), { x: 78, y: 29 });
});

test('resamples long strokes according to brush spacing', () => {
  const sparse = createRetouchStroke([{ x: 4, y: 4 }, { x: 84, y: 4 }], {
    tool: 'clone', sourceOffset: { x: 0, y: 10 }, size: 20, spacing: 1
  });
  const dense = createRetouchStroke(sparse.points, { ...sparse, spacing: 0.1 });
  assert.ok(retouchStampPlan(dense).length > retouchStampPlan(sparse).length * 4);
  const bounds = retouchPatchBounds(dense, 100, 50);
  assert.ok(bounds.x <= 4 && bounds.x + bounds.width >= 84);
});

test('clone stamp copies source pixels into a transparent patch', () => {
  const width = 16;
  const height = 10;
  const source = image(width, height, (x, y) => [x * 10, y * 20, 40, 255]);
  const stroke = createRetouchStroke([{ x: 10, y: 5 }], {
    tool: 'clone', sourceOffset: { x: -6, y: -2 }, size: 3, hardness: 1, opacity: 1, flow: 1, spacing: 0.2
  });
  const result = processRetouchStroke(source, width, height, stroke);
  const copied = patchPixel(result, 10, 5);
  assert.ok(Math.abs(copied[0] - 40) <= 6);
  assert.ok(Math.abs(copied[1] - 60) <= 10);
  assert.equal(copied[3], 255);
});

test('soft clone edges fade while hard edges remain opaque', () => {
  const source = image(20, 20, () => [200, 100, 50, 255]);
  const soft = processRetouchStroke(source, 20, 20, createRetouchStroke([{ x: 10, y: 10 }], {
    tool: 'clone', sourceOffset: { x: 0, y: 0 }, size: 10, hardness: 0, opacity: 1, flow: 1
  }));
  const hard = processRetouchStroke(source, 20, 20, createRetouchStroke([{ x: 10, y: 10 }], {
    tool: 'clone', sourceOffset: { x: 0, y: 0 }, size: 10, hardness: 1, opacity: 1, flow: 1
  }));
  assert.ok(patchPixel(soft, 14, 10)[3] < patchPixel(hard, 14, 10)[3]);
  assert.equal(patchPixel(hard, 14, 10)[3], 255);
});

test('healing adapts sampled texture toward destination color', () => {
  const width = 30;
  const height = 12;
  const source = image(width, height, (x, y) => x < 15 ? [40 + (x + y) % 8, 45, 50, 255] : [170 + (x + y) % 8, 175, 180, 255]);
  const cloneStroke = createRetouchStroke([{ x: 22, y: 6 }], {
    tool: 'clone', sourceOffset: { x: -16, y: 0 }, size: 7, hardness: 0.8, opacity: 1, flow: 1
  });
  const healStroke = createRetouchStroke(cloneStroke.points, { ...cloneStroke, tool: 'healing' });
  const clone = patchPixel(processRetouchStroke(source, width, height, cloneStroke), 22, 6);
  const healing = patchPixel(processRetouchStroke(source, width, height, healStroke), 22, 6);
  assert.ok(healing[0] > clone[0] + 70);
  assert.ok(Math.abs(healing[0] - source[(6 * width + 22) * 4]) < 35);
});

test('spot healing chooses a valid nearby sample and creates a patch', () => {
  const width = 24;
  const height = 24;
  const source = image(width, height, (x, y) => x === 12 && y === 12 ? [0, 0, 0, 255] : [180, 160, 140, 255]);
  const offset = chooseSpotSourceOffset({ x: 12, y: 12 }, width, height, 8);
  const stroke = createRetouchStroke([{ x: 12, y: 12 }], {
    tool: 'spot-healing', sourceOffset: offset, size: 8, hardness: 0.5, opacity: 1, flow: 1
  });
  const result = processRetouchStroke(source, width, height, stroke);
  assert.ok(patchPixel(result, 12, 12)[0] > 120);
});

test('selection mask strictly limits modified pixels', () => {
  const width = 12;
  const height = 8;
  const source = image(width, height, () => [220, 80, 30, 255]);
  const mask = new Uint8Array(width * height);
  mask[4 * width + 8] = 255;
  const stroke = createRetouchStroke([{ x: 8, y: 4 }], {
    tool: 'clone', sourceOffset: { x: -4, y: 0 }, size: 8, hardness: 1, opacity: 1, flow: 1
  });
  const result = processRetouchStroke(source, width, height, stroke, mask);
  assert.equal(patchPixel(result, 8, 4)[3], 255);
  assert.equal(patchPixel(result, 7, 4)[3], 0);
});

test('processor falls back synchronously when Worker is unavailable', async () => {
  const processor = new RetouchProcessor({ workerFactory: () => null });
  const source = image(8, 8, () => [90, 100, 110, 255]);
  const stroke = createRetouchStroke([{ x: 4, y: 4 }], {
    tool: 'clone', sourceOffset: { x: -2, y: 0 }, size: 4, hardness: 1
  });
  const result = await processor.process(source, 8, 8, stroke);
  assert.ok(result.data.length > 0);
  processor.dispose();
});

test('one retouch stroke is one undo redo command and remains serializable', () => {
  const base = createRasterLayer({ id: 'base', name: 'Base', assetId: 'base-asset', width: 20, height: 20 });
  const documentModel = createEditorDocument({ width: 20, height: 20, layers: [base], activeLayerId: base.id });
  const history = new CommandHistory();
  const stroke = createRetouchStroke([{ x: 10, y: 10 }], {
    id: 'stroke-1', tool: 'clone', sourceOffset: { x: -4, y: 0 }, sourcePoint: { x: 6, y: 10 },
    size: 8, patchAssetId: 'patch-1', bounds: { x: 6, y: 6, width: 8, height: 8 }
  });
  history.execute(createAppendRetouchStrokeCommand(stroke), documentModel);
  const retouch = documentModel.layers.find(isRetouchLayer);
  assert.ok(retouch);
  assert.equal(retouch.metadata.strokes.length, 1);
  assert.equal(history.undoStack.length, 1);
  history.undo(documentModel);
  assert.equal(documentModel.layers.some(isRetouchLayer), false);
  history.redo(documentModel);
  assert.equal(documentModel.layers.find(isRetouchLayer).metadata.strokes[0].patchAssetId, 'patch-1');
  assert.doesNotThrow(() => JSON.stringify(documentModel));
});

test('project asset index includes retouch patches referenced only by redo history', () => {
  const documentModel = createEditorDocument({ width: 10, height: 10, layers: [] });
  const history = new CommandHistory();
  const stroke = createRetouchStroke([{ x: 5, y: 5 }], {
    tool: 'clone', sourceOffset: { x: -2, y: 0 }, patchAssetId: 'retouch-patch-redo', bounds: { x: 2, y: 2, width: 6, height: 6 }
  });
  history.execute(createAppendRetouchStrokeCommand(stroke), documentModel);
  history.undo(documentModel);
  const historySnapshot = history.toJSON();
  assert.deepEqual(referencedAssetIds(documentModel.toJSON(), historySnapshot), ['retouch-patch-redo']);
  const project = createProjectRecord({ document: documentModel.toJSON(), history: historySnapshot });
  assert.ok(project.assetIds.includes('retouch-patch-redo'));
});

test('retouch metadata normalizes and identifies a layer', () => {
  const metadata = createRetouchLayerMetadata();
  const layer = { type: 'group', metadata, children: [] };
  assert.equal(isRetouchLayer(layer), true);
  assert.deepEqual(metadata.strokes, []);
  assert.doesNotThrow(() => JSON.stringify(layer));
});
