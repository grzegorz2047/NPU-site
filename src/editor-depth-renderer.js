import { applyDepthEffectTiled, createDepthEffect } from './editor-depth-effects.js';

const INSTALL_KEY = Symbol.for('localstudio.depth-renderer');

export function isDepthEffectLayer(layer) { return Boolean(layer?.metadata?.kind === 'depth-effect' && layer.metadata.depthEffect?.type && layer.metadata.depthAssetId); }

export function installDepthRendering(renderer) {
  if (!renderer?.render || !renderer?.canvas) throw new TypeError('Efekty głębi wymagają renderera dokumentu.');
  if (renderer[INSTALL_KEY]) return renderer[INSTALL_KEY];
  const baseRender = renderer.render.bind(renderer);
  const integration = { baseRender, uninstall() { renderer.render = baseRender; delete renderer[INSTALL_KEY]; } };
  renderer.render = (documentModel, options = {}) => {
    const effects = documentModel.layers.filter(isDepthEffectLayer);
    if (!effects.length || options.includeDepthEffects === false) return baseRender(documentView(documentModel, options.includeDepthEffects === false ? documentModel.layers.filter(layer => !isDepthEffectLayer(layer)) : documentModel.layers), options);
    const renderedLayerIds = [];
    baseRender(documentView(documentModel, []), { ...options, clear: options.clear !== false });
    let segment = [];
    const flush = () => { if (!segment.length) return; const result = baseRender(documentView(documentModel, segment), { ...options, clear: false }); renderedLayerIds.push(...(result.renderedLayerIds ?? [])); segment = []; };
    for (const layer of documentModel.layers) {
      if (!isDepthEffectLayer(layer)) { segment.push(layer); continue; }
      flush();
      if (!layer.visible || layer.opacity <= 0) continue;
      applyDepthEffectLayer(renderer, documentModel, layer);
      renderedLayerIds.push(layer.id);
    }
    flush();
    return { plan: documentModel.layers.map(layer => ({ layerId: layer.id, type: isDepthEffectLayer(layer) ? 'depth-effect' : layer.type })), renderedLayerIds };
  };
  renderer[INSTALL_KEY] = integration;
  return integration;
}

export function applyDepthEffectLayer(renderer, documentModel, layer) {
  const context = renderer.canvas.getContext('2d', { willReadFrequently: true });
  const width = documentModel.width;
  const height = documentModel.height;
  const source = context.getImageData(0, 0, width, height);
  const asset = renderer.resolveAsset(layer.metadata.depthAssetId, documentModel);
  if (!asset) return;
  const depth = readDepthAsset(asset, width, height);
  const effect = createDepthEffect(layer.metadata.depthEffect.type, layer.metadata.depthEffect.parameters);
  const processed = applyDepthEffectTiled(source.data, depth, width, height, effect, layer.metadata.tileOptions ?? {});
  const output = blendEffect(source.data, processed, layer.opacity, layer.blendMode);
  const imageData = context.createImageData(width, height);
  imageData.data.set(output);
  context.putImageData(imageData, 0, 0);
}

export function blendEffect(original, changed, opacity = 1, blendMode = 'normal') {
  const output = new Uint8ClampedArray(original);
  const alpha = Math.min(1, Math.max(0, Number(opacity) || 0));
  for (let offset = 0; offset < output.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const base = original[offset + channel];
      const effect = changed[offset + channel];
      const blended = blendChannel(base, effect, blendMode);
      output[offset + channel] = Math.round(base + (blended - base) * alpha);
    }
    output[offset + 3] = original[offset + 3];
  }
  return output;
}

export function readDepthAsset(asset, width, height) {
  if (asset?.data && asset.data.length === width * height) return asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data);
  if (typeof document === 'undefined') throw new Error('Nie można odczytać mapy głębi poza przeglądarką.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(asset, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data; const output = new Uint8Array(width * height);
  for (let index = 0; index < output.length; index += 1) output[index] = rgba[index * 4];
  return output;
}

export function depthMapToCanvas(map, width, height) {
  if (typeof document === 'undefined') return { data: new Uint8Array(map), width, height };
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); const imageData = context.createImageData(width, height);
  for (let index = 0; index < map.length; index += 1) { const offset = index * 4; const value = map[index]; imageData.data[offset] = value; imageData.data[offset + 1] = value; imageData.data[offset + 2] = value; imageData.data[offset + 3] = 255; }
  context.putImageData(imageData, 0, 0); return canvas;
}
function documentView(documentModel, layers) { const view = Object.create(documentModel); view.layers = layers; return view; }
function blendChannel(base, effect, mode) { const a = base / 255; const b = effect / 255; if (mode === 'multiply') return a * b * 255; if (mode === 'screen') return (1 - (1 - a) * (1 - b)) * 255; if (mode === 'overlay') return (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) * 255; return effect; }
