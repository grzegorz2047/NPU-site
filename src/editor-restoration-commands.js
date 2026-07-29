import { createId, createRasterLayer } from './editor-document.js';
import { createDocumentCommand } from './editor-history.js';

export function createAddRestorationLayerCommand(documentModel, result, options = {}) {
  if (!result?.canvas || !result.width || !result.height) throw new Error('Wynik restoration nie zawiera obrazu.');
  const assetId = options.assetId ?? createId('restoration');
  const sourceLayerId = options.sourceLayerId ?? documentModel.activeLayerId ?? null;
  const layer = createRasterLayer({
    name: options.name ?? restorationLayerName(result),
    assetId,
    width: result.width,
    height: result.height,
    metadata: {
      kind: 'restoration',
      role: 'restoration-result',
      sourceLayerId,
      task: result.task,
      profileId: result.profileId,
      modelId: result.modelId ?? null,
      backend: result.backend ?? 'local',
      tileCount: result.tileCount ?? 1,
      fallbackReason: result.fallbackReason ?? null,
      durationMs: result.durationMs ?? null,
      memory: result.memory ?? null,
      benchmark: result.benchmark ?? null,
      createdAt: new Date().toISOString()
    }
  });
  return createDocumentCommand(options.label ?? `Dodaj wynik: ${layer.name}`, target => {
    target.setRuntimeAsset(assetId, cloneCanvas(result.canvas, result.width, result.height));
    if (options.resizeDocument !== false && (target.width !== result.width || target.height !== result.height)) {
      target.width = result.width;
      target.height = result.height;
      target.metadata = { ...target.metadata, restorationResize: { width: result.width, height: result.height, sourceLayerId } };
    }
    target.addLayer(layer, options.index ?? target.layers.length, null);
    target.touch();
    target.emit('restoration:add', { layer: target.getLayer(layer.id), result: { task: result.task, backend: result.backend, modelId: result.modelId } });
  });
}

export function restorationLayerName(result) {
  const names = {
    'super-resolution': `Super-resolution ${result.width}×${result.height}`,
    denoise: 'Odszumiony obraz',
    'jpeg-restoration': 'Naprawa artefaktów JPEG',
    deblur: 'Redukcja poruszenia'
  };
  return names[result.task] ?? 'Wynik restoration';
}

function cloneCanvas(source, width, height) {
  if (typeof document === 'undefined') return source;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return canvas;
}
