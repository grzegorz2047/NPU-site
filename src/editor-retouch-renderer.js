import { applyTransform } from './editor-renderer.js';
import { isRetouchLayer } from './editor-retouch.js';

const INSTALL_KEY = Symbol.for('localstudio.retouch-renderer');

export function installRetouchRendering(renderer) {
  if (!renderer?.renderLayer) throw new TypeError('Integracja retuszu wymaga renderera dokumentu.');
  if (renderer[INSTALL_KEY]) return renderer[INSTALL_KEY];
  const baseRenderLayer = renderer.renderLayer.bind(renderer);
  const integration = {
    baseRenderLayer,
    uninstall() {
      renderer.renderLayer = baseRenderLayer;
      delete renderer[INSTALL_KEY];
    }
  };
  renderer.renderLayer = (layer, documentModel, renderedLayerIds = []) => {
    if (!isRetouchLayer(layer)) return baseRenderLayer(layer, documentModel, renderedLayerIds);
    return renderRetouchLayer(renderer, layer, documentModel);
  };
  renderer[INSTALL_KEY] = integration;
  return integration;
}

export function renderRetouchLayer(renderer, layer, documentModel) {
  let canvas = renderer.createCanvas(documentModel.width, documentModel.height);
  const context = canvas.getContext('2d');
  for (const stroke of layer.metadata.strokes ?? []) {
    if (!stroke.patchAssetId || !stroke.bounds) continue;
    const patch = renderer.resolveAsset(stroke.patchAssetId, documentModel);
    if (!patch) continue;
    context.drawImage(patch, stroke.bounds.x, stroke.bounds.y, stroke.bounds.width, stroke.bounds.height);
  }
  if (!identityTransform(layer.transform)) {
    const transformed = renderer.createCanvas(documentModel.width, documentModel.height);
    const transformedContext = transformed.getContext('2d');
    transformedContext.save?.();
    applyTransform(transformedContext, layer.transform);
    transformedContext.drawImage(canvas, 0, 0);
    transformedContext.restore?.();
    canvas = transformed;
  }
  if (layer.mask?.enabled) {
    if (layer.mask.assetId) {
      const asset = renderer.resolveAsset(layer.mask.assetId, documentModel);
      if (asset) canvas = renderer.applyAlphaSource(canvas, asset, layer.mask.inverted, layer.mask.opacity);
    }
    const eraseStrokes = layer.mask.metadata?.eraseStrokes ?? [];
    if (eraseStrokes.length) canvas = renderer.applyEraseStrokes(canvas, eraseStrokes, documentModel);
  }
  return canvas;
}

function identityTransform(transform = {}) {
  return !Number(transform.x)
    && !Number(transform.y)
    && !Number(transform.rotation)
    && !Number(transform.skewX)
    && !Number(transform.skewY)
    && !Number(transform.perspectiveX)
    && !Number(transform.perspectiveY)
    && (transform.scaleX === undefined || Number(transform.scaleX) === 1)
    && (transform.scaleY === undefined || Number(transform.scaleY) === 1);
}
