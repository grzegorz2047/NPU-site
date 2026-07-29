import { applyAdjustmentToRgba, normalizeAdjustment } from './editor-adjustments.js';

const INSTALL_KEY = Symbol.for('localstudio.adjustment-renderer');

export function isAdjustmentLayer(layer) {
  return Boolean(layer?.metadata?.kind === 'adjustment' && layer.metadata.adjustment);
}

export function installAdjustmentRendering(renderer) {
  if (!renderer?.render || !renderer?.canvas) throw new TypeError('Integracja korekt wymaga renderera dokumentu.');
  if (renderer[INSTALL_KEY]) return renderer[INSTALL_KEY];
  const baseRender = renderer.render.bind(renderer);
  const integration = {
    baseRender,
    uninstall() {
      renderer.render = baseRender;
      delete renderer[INSTALL_KEY];
    }
  };

  renderer.render = (documentModel, options = {}) => {
    const adjustmentLayers = documentModel.layers.filter(isAdjustmentLayer);
    if (!adjustmentLayers.length) {
      const result = baseRender(documentModel, options);
      emitRenderComplete(documentModel, renderer, result, options);
      return result;
    }
    if (options.includeAdjustments === false) {
      const result = baseRender(documentView(documentModel, documentModel.layers.filter(layer => !isAdjustmentLayer(layer))), options);
      emitRenderComplete(documentModel, renderer, result, options);
      return result;
    }

    const clear = options.clear !== false;
    const renderedLayerIds = [];
    baseRender(documentView(documentModel, []), { ...options, clear });
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      const result = baseRender(documentView(documentModel, segment), { ...options, clear: false });
      renderedLayerIds.push(...result.renderedLayerIds);
      segment = [];
    };

    for (const layer of documentModel.layers) {
      if (!isAdjustmentLayer(layer)) {
        segment.push(layer);
        continue;
      }
      flush();
      if (!layer.visible || layer.opacity <= 0) continue;
      applyAdjustmentLayer(renderer, documentModel, layer);
      renderedLayerIds.push(layer.id);
    }
    flush();
    const result = { plan: buildAdjustmentPlan(documentModel), renderedLayerIds };
    emitRenderComplete(documentModel, renderer, result, options);
    return result;
  };

  renderer[INSTALL_KEY] = integration;
  return integration;
}

export function applyAdjustmentLayer(renderer, documentModel, layer) {
  const context = renderer.canvas.getContext('2d', { willReadFrequently: true });
  if (!context?.getImageData || !context?.putImageData) throw new Error('Przeglądarka nie udostępnia danych pikseli wymaganych przez korekty.');
  const width = documentModel.width;
  const height = documentModel.height;
  const original = context.getImageData(0, 0, width, height);
  const adjusted = applyAdjustmentToRgba(original.data, width, height, normalizeAdjustment(layer.metadata.adjustment));
  const mask = resolveMask(renderer, documentModel, layer, width, height);
  const output = blendAdjustmentPixels(original.data, adjusted, {
    opacity: layer.opacity,
    mask,
    blendMode: layer.blendMode
  });
  const imageData = context.createImageData(width, height);
  imageData.data.set(output);
  context.putImageData(imageData, 0, 0);
}

export function blendAdjustmentPixels(original, adjusted, { opacity = 1, mask = null, blendMode = 'normal' } = {}) {
  if (!original || !adjusted || original.length !== adjusted.length || original.length % 4 !== 0) {
    throw new Error('Korekta wymaga zgodnych danych RGBA.');
  }
  const output = new Uint8ClampedArray(original);
  const layerOpacity = Math.min(1, Math.max(0, Number(opacity) || 0));
  const pixels = original.length / 4;
  if (mask && mask.length !== pixels) throw new Error('Maska korekty ma nieprawidłowy rozmiar.');
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const maskValue = mask ? Math.min(1, Math.max(0, Number(mask[pixel]) || 0)) : 1;
    const factor = layerOpacity * maskValue;
    if (factor <= 0 || original[offset + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = original[offset + channel];
      const changed = adjusted[offset + channel];
      const blended = blendChannel(base, changed, blendMode);
      output[offset + channel] = Math.round(base + (blended - base) * factor);
    }
    output[offset + 3] = original[offset + 3];
  }
  return output;
}

export function adjustmentLayerDescriptor(layer) {
  return isAdjustmentLayer(layer) ? normalizeAdjustment(layer.metadata.adjustment) : null;
}

function resolveMask(renderer, documentModel, layer, width, height) {
  const mask = layer.mask;
  if (!mask?.enabled) return null;
  const hasErase = Boolean(mask.metadata?.eraseStrokes?.length);
  if (!mask.assetId && !hasErase) return null;
  let maskCanvas = renderer.createCanvas(width, height);
  const context = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (mask.assetId) {
    const asset = renderer.resolveAsset(mask.assetId, documentModel);
    if (asset) context.drawImage(asset, 0, 0, width, height);
    else context.clearRect(0, 0, width, height);
  } else {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  }
  if (hasErase) maskCanvas = renderer.applyEraseStrokes(maskCanvas, mask.metadata.eraseStrokes, documentModel);
  const data = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const values = new Float32Array(width * height);
  const maskOpacity = Math.min(1, Math.max(0, Number(mask.opacity) || 0));
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    let alpha = data[pixel * 4 + 3] / 255;
    if (mask.inverted) alpha = 1 - alpha;
    values[pixel] = alpha * maskOpacity;
  }
  return values;
}

function blendChannel(base, changed, blendMode) {
  const a = base / 255;
  const b = changed / 255;
  if (blendMode === 'multiply') return a * b * 255;
  if (blendMode === 'screen') return (1 - (1 - a) * (1 - b)) * 255;
  if (blendMode === 'overlay') return (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) * 255;
  return changed;
}

function buildAdjustmentPlan(documentModel) {
  return documentModel.layers
    .filter(layer => layer.visible && layer.opacity > 0)
    .map(layer => ({
      layer,
      layerId: layer.id,
      type: isAdjustmentLayer(layer) ? 'adjustment' : layer.type,
      opacity: layer.opacity,
      blendMode: layer.blendMode
    }));
}

function documentView(documentModel, layers) {
  const view = Object.create(documentModel);
  view.layers = layers;
  return view;
}

function emitRenderComplete(documentModel, renderer, result, options) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('localstudio:render-complete', {
    detail: { documentModel, canvas: renderer.canvas, result, includeAdjustments: options.includeAdjustments !== false }
  }));
}
