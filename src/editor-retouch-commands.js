import { createGroupLayer, createLayerMask } from './editor-document.js';
import { createDocumentCommand } from './editor-history.js';
import { createRetouchLayerMetadata, createRetouchStroke, isRetouchLayer } from './editor-retouch.js';

export function createAppendRetouchStrokeCommand(strokeInput, { layerId = null, layerName = 'Retusz', index = null } = {}) {
  const stroke = createRetouchStroke(strokeInput.points, strokeInput);
  return createDocumentCommand(retouchLabel(stroke.tool), documentModel => {
    let layer = layerId ? documentModel.getLayer(layerId) : null;
    if (!layer) {
      layer = createGroupLayer({
        name: layerName,
        metadata: createRetouchLayerMetadata(),
        mask: createLayerMask({ enabled: true, metadata: { mode: 'full' } }),
        children: []
      });
      layer = documentModel.addLayer(layer, index ?? documentModel.layers.length);
    }
    if (!isRetouchLayer(layer)) throw new Error('Pociągnięcie retuszu wymaga warstwy retuszu.');
    if (layer.locked) throw new Error('Warstwa retuszu jest zablokowana.');
    layer.metadata = {
      ...layer.metadata,
      kind: 'retouch',
      version: 1,
      strokes: [...(layer.metadata.strokes ?? []), stroke]
    };
    documentModel.setSelection([layer.id], layer.id, { emit: false });
    documentModel.touch();
    documentModel.emit('retouch:stroke', { layer, stroke });
  });
}

export function findRetouchLayer(documentModel, preferredId = null) {
  const preferred = preferredId ? documentModel.getLayer(preferredId) : null;
  if (preferred && isRetouchLayer(preferred) && !preferred.locked) return preferred;
  return [...documentModel.layers].reverse().find(layer => isRetouchLayer(layer) && !layer.locked) ?? null;
}

function retouchLabel(tool) {
  if (tool === 'healing') return 'Pociągnięcie healing brush';
  if (tool === 'spot-healing') return 'Pociągnięcie spot healing';
  return 'Pociągnięcie clone stamp';
}
