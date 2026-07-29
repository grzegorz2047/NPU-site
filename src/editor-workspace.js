import { createEditorDocument, createId, createLayerMask, createRasterLayer } from './editor-document.js';
import { addLayerCommand, CommandHistory, updateLayerCommand } from './editor-history.js';
import { LayersPanel } from './editor-layers-ui.js';
import { CanvasDocumentRenderer } from './editor-renderer.js';

const canvas = document.getElementById('result-canvas');

if (canvas) {
  const documentModel = createEditorDocument({ width: canvas.width, height: canvas.height, name: 'Bez nazwy' });
  const history = new CommandHistory({ limit: 100 });
  const renderer = new CanvasDocumentRenderer({
    canvas,
    assetResolver: assetId => documentModel.getRuntimeAsset(assetId)
  });
  const layersPanel = new LayersPanel({ documentModel, history, renderer, root: document });
  const documentTitle = document.getElementById('document-title');
  let lastSourceBitmap = null;
  let renderRevision = 0;

  document.addEventListener('localstudio:legacy-render', event => {
    const detail = event.detail ?? {};
    if (!detail.canvas || !detail.width || !detail.height) return;
    const importedNewImage = detail.sourceBitmap && detail.sourceBitmap !== lastSourceBitmap;
    if (importedNewImage || !findBaseLayer(documentModel)) {
      resetFromLegacy(detail);
      lastSourceBitmap = detail.sourceBitmap ?? lastSourceBitmap;
    } else {
      syncBaseFromLegacy(detail);
    }
    renderer.render(documentModel);
  });

  function resetFromLegacy(detail) {
    documentModel.clearRuntimeAssets();
    const assetId = createId('asset');
    const baseLayer = createRasterLayer({
      name: detail.name || 'Warstwa bazowa',
      assetId,
      width: detail.width,
      height: detail.height,
      metadata: { role: 'legacy-base', source: 'editor-app', importedAt: new Date().toISOString() }
    });
    documentModel.restore({
      id: createId('document'),
      name: detail.name || 'Bez nazwy',
      width: detail.width,
      height: detail.height,
      metadata: {
        source: 'localstudio-import',
        sourceName: detail.name || 'image',
        nonDestructiveCoreVersion: 1
      },
      layers: [baseLayer],
      activeLayerId: baseLayer.id,
      selectedLayerIds: [baseLayer.id]
    }, { preserveRuntimeAssets: false });
    history.clear();
    syncBaseFromLegacy(detail);
  }

  function syncBaseFromLegacy(detail) {
    const baseLayer = findBaseLayer(documentModel);
    if (!baseLayer) return;
    const snapshot = cloneCanvas(detail.canvas, detail.width, detail.height);
    documentModel.setRuntimeAsset(baseLayer.content.assetId, snapshot);
    baseLayer.content.width = detail.width;
    baseLayer.content.height = detail.height;
    baseLayer.metadata.legacyRevision = ++renderRevision;
    baseLayer.metadata.aiMaskPrepared = Boolean(detail.mask);
    documentModel.width = detail.width;
    documentModel.height = detail.height;
    documentModel.name = detail.name || documentModel.name;
    if (documentTitle) documentTitle.textContent = documentModel.name;

    if (detail.mask) {
      const maskAssetId = baseLayer.mask?.assetId ?? createId('mask');
      documentModel.setRuntimeAsset(maskAssetId, maskToCanvas(detail.mask, detail.width, detail.height));
      baseLayer.mask = createLayerMask({
        enabled: false,
        assetId: maskAssetId,
        metadata: {
          source: 'MODNet',
          prepared: true,
          bounds: detail.bounds ?? null,
          note: 'Maska jest przygotowana do niedestrukcyjnego użycia; legacy pipeline pozostaje źródłem bazowej kompozycji.'
        }
      });
    } else {
      baseLayer.mask = null;
    }
    documentModel.emit('legacy:sync', { layer: baseLayer });
  }

  function addAIResultLayer({ source, name = 'Wynik AI', mask = null, metadata = {} } = {}) {
    if (!source) throw new Error('Wynik AI wymaga źródła obrazu.');
    const assetId = createId('asset');
    const width = source.width || documentModel.width;
    const height = source.height || documentModel.height;
    documentModel.setRuntimeAsset(assetId, cloneCanvas(source, width, height));
    const layer = createRasterLayer({
      name,
      assetId,
      width,
      height,
      metadata: { ...metadata, source: metadata.source ?? 'ai-result' }
    });
    if (mask) {
      const maskAssetId = createId('mask');
      documentModel.setRuntimeAsset(maskAssetId, maskToCanvas(mask, width, height));
      layer.mask = createLayerMask({ assetId: maskAssetId, metadata: { source: 'ai-result' } });
    }
    history.execute(addLayerCommand(layer), documentModel);
    renderer.render(documentModel);
    return layer;
  }

  function applyAIResultAsMask(layerId, mask, options = {}) {
    const layer = documentModel.getLayer(layerId);
    if (!layer) throw new Error(`Nie znaleziono warstwy ${layerId}.`);
    const maskAssetId = createId('mask');
    documentModel.setRuntimeAsset(maskAssetId, maskToCanvas(mask, documentModel.width, documentModel.height));
    history.execute(updateLayerCommand(layerId, {
      mask: createLayerMask({
        enabled: options.enabled !== false,
        assetId: maskAssetId,
        inverted: options.inverted,
        opacity: options.opacity,
        metadata: { ...options.metadata, source: options.metadata?.source ?? 'ai-result' }
      })
    }, { label: 'Dodaj maskę AI' }), documentModel);
    renderer.render(documentModel);
  }

  globalThis.localStudioEditor = Object.freeze({
    document: documentModel,
    history,
    renderer,
    layersPanel,
    addAIResultLayer,
    applyAIResultAsMask,
    render: () => renderer.render(documentModel),
    getExportCanvas: () => {
      renderer.render(documentModel);
      return canvas;
    },
    serialize: () => documentModel.toJSON()
  });
}

function findBaseLayer(documentModel) {
  return documentModel.layers.find(layer => layer.metadata?.role === 'legacy-base') ?? null;
}

function cloneCanvas(source, width, height) {
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  output.getContext('2d').drawImage(source, 0, 0, width, height);
  return output;
}

function maskToCanvas(mask, width, height) {
  if (mask?.getContext || (typeof HTMLImageElement !== 'undefined' && mask instanceof HTMLImageElement) || (typeof ImageBitmap !== 'undefined' && mask instanceof ImageBitmap)) {
    return cloneCanvas(mask, width, height);
  }
  const values = mask?.data ?? mask;
  if (!values || typeof values.length !== 'number') throw new Error('Nieprawidłowe dane maski.');
  const sourceWidth = values.length === width * height ? width : Math.round(Math.sqrt(values.length));
  const sourceHeight = Math.max(1, Math.round(values.length / sourceWidth));
  const source = document.createElement('canvas');
  source.width = sourceWidth;
  source.height = sourceHeight;
  const context = source.getContext('2d');
  const imageData = context.createImageData(sourceWidth, sourceHeight);
  for (let index = 0; index < sourceWidth * sourceHeight; index += 1) {
    const alpha = Math.round(Math.min(1, Math.max(0, Number(values[index]) || 0)) * 255);
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);
  return cloneCanvas(source, width, height);
}
