import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocument, createGroupLayer, createRasterLayer } from '../src/editor-document.js';
import { buildRenderPlan, CanvasDocumentRenderer, resolveCompositeOperation } from '../src/editor-renderer.js';

test('builds render plan in bottom-to-top order and skips hidden layers', () => {
  const documentModel = createEditorDocument({
    width: 100,
    height: 100,
    layers: [
      createRasterLayer({ id: 'bottom' }),
      createRasterLayer({ id: 'hidden', visible: false }),
      createRasterLayer({ id: 'top', blendMode: 'screen', opacity: 0.5 })
    ]
  });
  const plan = buildRenderPlan(documentModel);
  assert.deepEqual(plan.map(item => item.layerId), ['bottom', 'top']);
  assert.equal(plan[1].compositeOperation, 'screen');
  assert.equal(plan[1].opacity, 0.5);
});

test('flattens visible groups while preserving child order and group opacity', () => {
  const documentModel = createEditorDocument({
    width: 10,
    height: 10,
    layers: [
      createGroupLayer({
        id: 'group',
        opacity: 0.5,
        children: [
          createRasterLayer({ id: 'child-a', opacity: 0.5 }),
          createRasterLayer({ id: 'child-b', blendMode: 'overlay' })
        ]
      })
    ]
  });
  const plan = buildRenderPlan(documentModel);
  assert.deepEqual(plan.map(item => item.layerId), ['child-a', 'child-b']);
  assert.equal(plan[0].opacity, 0.25);
  assert.equal(plan[1].opacity, 0.5);
  assert.equal(plan[1].groupId, 'group');
});

test('maps supported blend modes to canvas operations', () => {
  assert.equal(resolveCompositeOperation('normal'), 'source-over');
  assert.equal(resolveCompositeOperation('multiply'), 'multiply');
  assert.equal(resolveCompositeOperation('screen'), 'screen');
  assert.equal(resolveCompositeOperation('overlay'), 'overlay');
  assert.equal(resolveCompositeOperation('unknown'), 'source-over');
});

test('renderer applies layer order and blend modes using an injectable canvas', () => {
  const main = fakeCanvas('main');
  const offscreens = [];
  const documentModel = createEditorDocument({
    width: 20,
    height: 10,
    layers: [
      createRasterLayer({ id: 'a', assetId: 'asset-a', blendMode: 'multiply' }),
      createRasterLayer({ id: 'b', assetId: 'asset-b', blendMode: 'overlay' })
    ]
  });
  documentModel.setRuntimeAsset('asset-a', { id: 'source-a', width: 20, height: 10 });
  documentModel.setRuntimeAsset('asset-b', { id: 'source-b', width: 20, height: 10 });
  const renderer = new CanvasDocumentRenderer({
    canvas: main,
    createCanvas(width, height) {
      const canvas = fakeCanvas(`offscreen-${offscreens.length}`, width, height);
      offscreens.push(canvas);
      return canvas;
    }
  });
  const result = renderer.render(documentModel);
  assert.deepEqual(result.renderedLayerIds, ['a', 'b']);
  const draws = main.context.calls.filter(call => call[0] === 'drawImage');
  assert.equal(draws.length, 2);
  assert.deepEqual(main.context.composites, ['source-over', 'multiply', 'source-over', 'overlay', 'source-over', 'source-over']);
});

function fakeCanvas(id, width = 1, height = 1) {
  const calls = [];
  const composites = [];
  let composite = 'source-over';
  const context = {
    calls,
    composites,
    globalAlpha: 1,
    get globalCompositeOperation() { return composite; },
    set globalCompositeOperation(value) { composite = value; composites.push(value); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); composite = 'source-over'; composites.push(composite); },
    setTransform(...args) { calls.push(['setTransform', ...args]); },
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    drawImage(source, ...args) { calls.push(['drawImage', source.id ?? source, ...args]); },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    transform(...args) { calls.push(['transform', ...args]); },
    beginPath() {}, rect() {}, fill() {}, stroke() {}, fillText() {}
  };
  return { id, width, height, context, getContext() { return context; } };
}

test('renderer applies layer masks and basic clipping masks', () => {
  const main = fakeCanvas('main');
  const offscreens = [];
  const documentModel = createEditorDocument({
    width: 20,
    height: 10,
    layers: [
      createRasterLayer({ id: 'base', assetId: 'asset-base' }),
      createRasterLayer({
        id: 'clipped',
        assetId: 'asset-top',
        mask: { assetId: 'asset-mask' },
        clipping: { enabled: true, baseLayerId: 'base' }
      })
    ]
  });
  documentModel.setRuntimeAsset('asset-base', { id: 'source-base', width: 20, height: 10 });
  documentModel.setRuntimeAsset('asset-top', { id: 'source-top', width: 20, height: 10 });
  documentModel.setRuntimeAsset('asset-mask', { id: 'source-mask', width: 20, height: 10 });
  const renderer = new CanvasDocumentRenderer({
    canvas: main,
    createCanvas(width, height) {
      const canvas = fakeCanvas(`offscreen-${offscreens.length}`, width, height);
      offscreens.push(canvas);
      return canvas;
    }
  });
  const result = renderer.render(documentModel);
  const composites = offscreens.flatMap(canvas => canvas.context.composites);
  assert.deepEqual(result.renderedLayerIds, ['base', 'clipped']);
  assert.equal(composites.filter(value => value === 'destination-in').length, 2);
});

test('renderer composites group children and applies group transform', () => {
  const main = fakeCanvas('main');
  const offscreens = [];
  const documentModel = createEditorDocument({
    width: 30,
    height: 20,
    layers: [createGroupLayer({
      id: 'group',
      transform: { x: 5, y: 3 },
      children: [createRasterLayer({ id: 'child', assetId: 'asset-child' })]
    })]
  });
  documentModel.setRuntimeAsset('asset-child', { id: 'source-child', width: 30, height: 20 });
  const renderer = new CanvasDocumentRenderer({
    canvas: main,
    createCanvas(width, height) {
      const canvas = fakeCanvas(`offscreen-${offscreens.length}`, width, height);
      offscreens.push(canvas);
      return canvas;
    }
  });
  const result = renderer.render(documentModel);
  const calls = offscreens.flatMap(canvas => canvas.context.calls);
  assert.deepEqual(result.renderedLayerIds, ['child', 'group']);
  assert.ok(calls.some(call => call[0] === 'translate' && call[1] === 5 && call[2] === 3));
});
