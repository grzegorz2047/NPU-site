import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSelection, contractSelection, createSelection, decodeMaskRuns, ellipseSelection, encodeMaskRuns, expandSelection, featherSelection, invertSelection, magicWandSelection, polygonSelection, rasterizeSelection, rectangleSelection, selectionBounds, selectionContains } from '../src/editor-selection.js';

function selectedCount(selection) { return [...rasterizeSelection(selection)].filter(value => value >= 128).length; }

test('rectangle, ellipse and polygon selections rasterize with useful bounds', () => {
  const rectangle = combineSelection(createSelection({ width: 12, height: 10 }), rectangleSelection({ x: 2, y: 3, width: 5, height: 4 }));
  assert.deepEqual(selectionBounds(rectangle), { x: 2, y: 3, width: 5, height: 4 });
  assert.equal(selectionContains(rectangle, 4, 4), true); assert.equal(selectionContains(rectangle, 0, 0), false);
  const ellipse = combineSelection(createSelection({ width: 12, height: 10 }), ellipseSelection({ x: 2, y: 2, width: 6, height: 6 }));
  assert.equal(selectionContains(ellipse, 5, 5), true); assert.equal(selectionContains(ellipse, 2, 2), false);
  const polygon = combineSelection(createSelection({ width: 12, height: 10 }), polygonSelection([{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 5, y: 8 }]));
  assert.equal(selectionContains(polygon, 5, 3), true); assert.equal(selectionContains(polygon, 10, 8), false);
});

test('selection add, subtract and intersect operations compose masks', () => {
  const base = combineSelection(createSelection({ width: 10, height: 10 }), rectangleSelection({ x: 1, y: 1, width: 5, height: 5 }));
  const added = combineSelection(base, rectangleSelection({ x: 6, y: 1, width: 3, height: 3 }), 'add');
  assert.ok(selectedCount(added) > selectedCount(base));
  const subtracted = combineSelection(added, rectangleSelection({ x: 2, y: 2, width: 2, height: 2 }), 'subtract');
  assert.equal(selectionContains(subtracted, 2, 2), false);
  const intersected = combineSelection(subtracted, rectangleSelection({ x: 5, y: 0, width: 5, height: 5 }), 'intersect');
  assert.equal(selectionContains(intersected, 1, 1), false); assert.equal(selectionContains(intersected, 7, 2), true);
});

test('expand, contract, feather and invert preserve serializable selection state', () => {
  const source = combineSelection(createSelection({ width: 15, height: 15 }), rectangleSelection({ x: 5, y: 5, width: 3, height: 3 }));
  const expanded = expandSelection(source, 2), contracted = contractSelection(expanded, 2), feathered = featherSelection(source, 2), inverted = invertSelection(source);
  assert.ok(selectedCount(expanded) > selectedCount(source)); assert.ok(selectedCount(contracted) <= selectedCount(expanded));
  assert.ok([...rasterizeSelection(feathered)].some(value => value > 0 && value < 255)); assert.equal(selectionContains(inverted, 0, 0), true); assert.doesNotThrow(() => JSON.stringify(feathered));
});

test('magic wand respects tolerance and contiguous regions', () => {
  const width = 5, height = 2;
  const pixels = new Uint8ClampedArray([10,10,10,255,12,12,12,255,200,0,0,255,10,10,10,255,10,10,10,255,10,10,10,255,10,10,10,255,200,0,0,255,10,10,10,255,10,10,10,255]);
  const contiguous = combineSelection(createSelection({ width, height }), magicWandSelection(pixels, width, height, { x: 0, y: 0 }, 5, { contiguous: true, antiAlias: false }));
  const global = combineSelection(createSelection({ width, height }), magicWandSelection(pixels, width, height, { x: 0, y: 0 }, 5, { contiguous: false, antiAlias: false }));
  assert.equal(selectedCount(contiguous), 4); assert.equal(selectedCount(global), 8); assert.equal(selectionContains(contiguous, 3, 0), false); assert.equal(selectionContains(global, 3, 0), true);
});

test('selection mask run-length encoding round-trips', () => {
  const mask = Uint8ClampedArray.from([0,0,255,255,255,64,64,0]), runs = encodeMaskRuns(mask);
  assert.deepEqual([...decodeMaskRuns(runs, mask.length)], [...mask]); assert.ok(runs.length < mask.length);
});
