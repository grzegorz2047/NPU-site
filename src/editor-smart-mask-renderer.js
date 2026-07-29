import { createId, createLayerMask } from './editor-document.js';
import { updateLayerCommand } from './editor-history.js';
import { applyTransform } from './editor-renderer.js';
import { normalizeMask } from './editor-smart-mask.js';

const INSTALL_KEY = Symbol.for('localstudio.smart-mask-renderer');

export function isLayerLocalSmartMask(layer) {
  return Boolean(layer?.mask?.enabled && layer.mask.metadata?.source === 'smart-select' && layer.mask.metadata?.coordinateSpace === 'layer');
}

export function installSmartMaskRendering(renderer) {
  if (!renderer?.renderLayer || !renderer?.drawLayerContent) throw new TypeError('Smart mask wymaga renderera dokumentu.');
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
    if (!isLayerLocalSmartMask(layer) || layer.type === 'group') return baseRenderLayer(layer, documentModel, renderedLayerIds);
    return renderLayerWithLocalMask(renderer, layer, documentModel);
  };
  renderer[INSTALL_KEY] = integration;
  return integration;
}

export function renderLayerWithLocalMask(renderer, layer, documentModel) {
  let localCanvas = renderer.createCanvas(documentModel.width, documentModel.height);
  const localContext = localCanvas.getContext('2d');
  localContext.save?.();
  renderer.drawLayerContent(localContext, layer, documentModel);
  localContext.restore?.();

  if (layer.mask.assetId) {
    const maskAsset = renderer.resolveAsset(layer.mask.assetId, documentModel);
    if (maskAsset) localCanvas = renderer.applyAlphaSource(localCanvas, maskAsset, layer.mask.inverted, layer.mask.opacity);
  }
  const eraseStrokes = layer.mask.metadata?.eraseStrokes ?? [];
  if (eraseStrokes.length) localCanvas = renderer.applyEraseStrokes(localCanvas, eraseStrokes, documentModel);

  if (isIdentityTransform(layer.transform)) return localCanvas;
  const transformed = renderer.createCanvas(documentModel.width, documentModel.height);
  const context = transformed.getContext('2d');
  context.save?.();
  applyTransform(context, layer.transform);
  context.drawImage(localCanvas, 0, 0);
  context.restore?.();
  return transformed;
}

export function applySmartMaskToLayer({ documentModel, history, renderer, layerId, mask, width = documentModel.width, height = documentModel.height, metadata = {}, label = 'Dodaj maskę Smart Select' }) {
  const layer = documentModel.getLayer(layerId);
  if (!layer) throw new Error(`Nie znaleziono warstwy ${layerId}.`);
  if (layer.locked) throw new Error('Warstwa jest zablokowana.');
  const values = normalizeMask(mask, width, height);
  const assetId = createId('smart-mask');
  documentModel.setRuntimeAsset(assetId, maskToCanvas(values, width, height));
  history.execute(updateLayerCommand(layerId, {
    mask: createLayerMask({
      enabled: true,
      assetId,
      opacity: 1,
      metadata: {
        source: 'smart-select',
        coordinateSpace: 'layer',
        width,
        height,
        createdAt: new Date().toISOString(),
        ...metadata
      }
    })
  }, { label }), documentModel);
  renderer?.render(documentModel);
  return assetId;
}

export function convertDocumentMaskToLayerSpace(maskInput, width, height, transform = {}) {
  const source = normalizeMask(maskInput, width, height);
  const output = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const documentPoint = transformLocalMaskPoint({ x: x + 0.5, y: y + 0.5 }, transform);
      const sourceX = Math.floor(documentPoint.x);
      const sourceY = Math.floor(documentPoint.y);
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
      output[y * width + x] = source[sourceY * width + sourceX];
    }
  }
  return output;
}

export function maskToCanvas(maskInput, width, height) {
  const values = normalizeMask(maskInput, width, height);
  if (typeof document === 'undefined') return { width, height, data: values };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = values[index];
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function transformLocalMaskPoint(point, transform = {}) {
  const x = Number(point.x) || 0;
  const y = Number(point.y) || 0;
  const originX = Number(transform.originX) || 0;
  const originY = Number(transform.originY) || 0;
  const scaleX = Number.isFinite(Number(transform.scaleX)) ? Number(transform.scaleX) : 1;
  const scaleY = Number.isFinite(Number(transform.scaleY)) ? Number(transform.scaleY) : 1;
  const rotation = (Number(transform.rotation) || 0) * Math.PI / 180;
  const skewX = Math.tan((Number(transform.skewX) || 0) * Math.PI / 180);
  const skewY = Math.tan((Number(transform.skewY) || 0) * Math.PI / 180);
  let localX = (x - originX) * scaleX;
  let localY = (y - originY) * scaleY;
  const skewedX = localX + localY * skewX;
  const skewedY = localY + localX * skewY;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: skewedX * cos - skewedY * sin + originX + (Number(transform.x) || 0),
    y: skewedX * sin + skewedY * cos + originY + (Number(transform.y) || 0)
  };
}

function isIdentityTransform(transform = {}) {
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
