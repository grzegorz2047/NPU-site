import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLEND_MODES,
  createEditorDocument,
  createGroupLayer,
  createLayerMask,
  createRasterLayer,
  createShapeLayer,
  createTextLayer
} from '../src/editor-document.js';

test('creates a serializable document with dimensions and metadata', () => {
  const documentModel = createEditorDocument({ width: 1920, height: 1080, name: 'Projekt', metadata: { author: 'local' } });
  assert.equal(documentModel.width, 1920);
  assert.equal(documentModel.height, 1080);
  assert.equal(documentModel.name, 'Projekt');
  assert.deepEqual(documentModel.metadata, { author: 'local' });
  assert.deepEqual(documentModel.layers, []);
  assert.doesNotThrow(() => JSON.stringify(documentModel));
});

test('supports raster, text, shape and group layers with common properties', () => {
  const layers = [
    createRasterLayer({ id: 'r', name: 'Raster', assetId: 'asset-1' }),
    createTextLayer({ id: 't', text: 'Hello' }),
    createShapeLayer({ id: 's', shape: 'ellipse' }),
    createGroupLayer({ id: 'g', children: [createRasterLayer({ id: 'nested' })] })
  ];
  for (const layer of layers) {
    assert.equal(typeof layer.id, 'string');
    assert.equal(layer.visible, true);
    assert.equal(layer.locked, false);
    assert.equal(layer.opacity, 1);
    assert.equal(layer.blendMode, 'normal');
    assert.deepEqual(Object.keys(layer.transform), ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'perspectiveX', 'perspectiveY', 'originX', 'originY']);
  }
  assert.equal(layers[3].children[0].id, 'nested');
});

test('adds, removes and duplicates layers while maintaining active selection', () => {
  const documentModel = createEditorDocument({ width: 100, height: 100 });
  const base = documentModel.addLayer(createRasterLayer({ id: 'base', name: 'Base' }));
  const second = documentModel.addLayer(createTextLayer({ id: 'text', name: 'Text' }));
  assert.equal(documentModel.activeLayerId, second.id);
  assert.deepEqual(documentModel.selectedLayerIds, [second.id]);

  const duplicate = documentModel.duplicateLayer(base.id);
  assert.notEqual(duplicate.id, base.id);
  assert.equal(duplicate.name, 'Base kopia');
  assert.deepEqual(documentModel.layers.map(layer => layer.name), ['Base', 'Base kopia', 'Text']);

  documentModel.removeLayer(duplicate.id);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base', 'text']);
  documentModel.removeLayer('text');
  assert.equal(documentModel.activeLayerId, 'base');
});

test('moves layers in bottom-to-top order', () => {
  const documentModel = createEditorDocument({
    width: 100,
    height: 100,
    layers: [
      createRasterLayer({ id: 'a' }),
      createRasterLayer({ id: 'b' }),
      createRasterLayer({ id: 'c' })
    ]
  });
  documentModel.moveLayer('a', 2);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['b', 'c', 'a']);
  documentModel.moveLayer('a', 0);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['a', 'b', 'c']);
});

test('supports active layer and multiple selection', () => {
  const documentModel = createEditorDocument({
    width: 10,
    height: 10,
    layers: [createRasterLayer({ id: 'a' }), createRasterLayer({ id: 'b' }), createRasterLayer({ id: 'c' })]
  });
  documentModel.setSelectedLayers(['a', 'c'], 'c');
  assert.deepEqual(documentModel.selectedLayerIds, ['a', 'c']);
  assert.equal(documentModel.activeLayerId, 'c');
  documentModel.setActiveLayer('b');
  assert.deepEqual(documentModel.selectedLayerIds, ['b']);
});

test('updates visibility, opacity, lock, name, blend, transform, mask and clipping', () => {
  const layer = createRasterLayer({ id: 'layer' });
  const documentModel = createEditorDocument({ width: 10, height: 10, layers: [layer] });
  documentModel.updateLayer('layer', {
    visible: false,
    opacity: 0.4,
    locked: true,
    name: 'Renamed',
    blendMode: 'multiply',
    transform: { x: 20, rotation: 45, perspectiveX: 4, perspectiveY: -4 },
    mask: createLayerMask({ assetId: 'mask-1', inverted: true }),
    clipping: { enabled: true, baseLayerId: 'base' }
  });
  const updated = documentModel.getLayer('layer');
  assert.equal(updated.visible, false);
  assert.equal(updated.opacity, 0.4);
  assert.equal(updated.locked, true);
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.blendMode, 'multiply');
  assert.equal(updated.transform.x, 20);
  assert.equal(updated.transform.rotation, 45);
  assert.equal(updated.transform.perspectiveX, 0.95);
  assert.equal(updated.transform.perspectiveY, -0.95);
  assert.equal(updated.mask.assetId, 'mask-1');
  assert.equal(updated.mask.inverted, true);
  assert.deepEqual(updated.clipping, { enabled: true, baseLayerId: 'base' });
  assert.deepEqual(BLEND_MODES, ['normal', 'multiply', 'screen', 'overlay']);
});

test('runtime image assets stay outside serialized structure', () => {
  const documentModel = createEditorDocument({ width: 1, height: 1, layers: [createRasterLayer({ id: 'base', assetId: 'asset' })] });
  const runtimeAsset = { width: 1, height: 1, native: true };
  documentModel.setRuntimeAsset('asset', runtimeAsset);
  assert.equal(documentModel.getRuntimeAsset('asset'), runtimeAsset);
  const serialized = JSON.parse(JSON.stringify(documentModel));
  assert.equal(serialized.runtimeAssets, undefined);
  assert.equal(serialized.layers[0].content.assetId, 'asset');
});

test('normalizes invalid document dimensions to at least one pixel', () => {
  const documentModel = createEditorDocument({ width: 0, height: -20 });
  assert.equal(documentModel.width, 1);
  assert.equal(documentModel.height, 1);
});
