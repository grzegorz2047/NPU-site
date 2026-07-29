import { createGroupLayer, createLayerMask } from './editor-document.js';
import { createDocumentCommand, updateLayerCommand } from './editor-history.js';
import { createDepthEffect } from './editor-depth-effects.js';
import { isDepthEffectLayer } from './editor-depth-renderer.js';

export function setDocumentDepthMapCommand(depthMap) {
  return createDocumentCommand('Zapisz mapę głębi', documentModel => {
    documentModel.metadata = { ...documentModel.metadata, depthMap: clone(depthMap) };
    documentModel.touch();
    documentModel.emit('depth-map:update', { depthMap: documentModel.metadata.depthMap });
  });
}

export function replaceDepthMapAssetCommand(depthMap) {
  return createDocumentCommand('Popraw mapę głębi', documentModel => {
    const previous = documentModel.metadata?.depthMap ?? {};
    documentModel.metadata = { ...documentModel.metadata, depthMap: { ...previous, ...clone(depthMap), editedAt: new Date().toISOString() } };
    for (const layer of documentModel.layers) if (isDepthEffectLayer(layer)) layer.metadata.depthAssetId = depthMap.assetId;
    documentModel.touch();
    documentModel.emit('depth-map:update', { depthMap: documentModel.metadata.depthMap });
  });
}

export function addDepthEffectCommand(type, depthAssetId, options = {}) {
  const effect = createDepthEffect(type, options.parameters);
  const layer = createGroupLayer({
    name: options.name ?? depthEffectName(type), opacity: options.opacity ?? 1, blendMode: options.blendMode ?? 'normal',
    mask: createLayerMask({ enabled: true, metadata: { mode: 'full' } }),
    metadata: { kind: 'depth-effect', depthAssetId, depthEffect: effect, tileOptions: { tileSize: 384, overlap: 32 }, createdAt: new Date().toISOString() }, children: []
  });
  return createDocumentCommand(`Dodaj efekt: ${layer.name}`, documentModel => documentModel.addLayer(layer, options.index ?? documentModel.layers.length));
}

export function updateDepthEffectCommand(layerId, patch, options = {}) {
  return updateLayerCommand(layerId, { metadata: patch }, { label: options.label ?? 'Zmień efekt głębi', coalesceKey: options.coalesceKey ?? null });
}
export function findActiveDepthEffect(documentModel) { const active = documentModel.activeLayer; return isDepthEffectLayer(active) ? active : null; }
function depthEffectName(type) { return ({ 'lens-blur': 'Lens Blur (głębia)', relight: 'Relighting (głębia)', atmosphere: 'Atmosfera (głębia)' })[type] ?? 'Efekt głębi'; }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
