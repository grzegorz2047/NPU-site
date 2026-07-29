export const COMPOSITE_OPERATIONS = Object.freeze({
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay'
});

export function resolveCompositeOperation(blendMode) {
  return COMPOSITE_OPERATIONS[blendMode] ?? COMPOSITE_OPERATIONS.normal;
}

export function buildRenderPlan(document) {
  const plan = [];
  const visit = (layers, inherited = {}) => {
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      if (layer.type === 'group') {
        visit(layer.children, {
          opacity: (inherited.opacity ?? 1) * layer.opacity,
          groupPath: [...(inherited.groupPath ?? []), layer.id]
        });
        continue;
      }
      plan.push({
        layer,
        layerId: layer.id,
        type: layer.type,
        opacity: (inherited.opacity ?? 1) * layer.opacity,
        blendMode: layer.blendMode,
        compositeOperation: resolveCompositeOperation(layer.blendMode),
        groupId: inherited.groupPath?.at(-1) ?? null,
        groupPath: inherited.groupPath ?? []
      });
    }
  };
  visit(document.layers);
  return plan;
}

export class CanvasDocumentRenderer {
  constructor({ canvas, createCanvas = defaultCreateCanvas, assetResolver = null } = {}) {
    if (!canvas?.getContext) throw new TypeError('Renderer wymaga głównego canvasa.');
    this.canvas = canvas;
    this.createCanvas = createCanvas;
    this.assetResolver = assetResolver;
  }

  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  render(document, options = {}) {
    this.resize(document.width, document.height);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Nie można uzyskać kontekstu 2D.');
    context.save?.();
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    if (options.clear !== false) context.clearRect(0, 0, document.width, document.height);

    const renderedLayerIds = [];
    this.renderLayerCollection(document.layers, document, context, renderedLayerIds);
    context.restore?.();
    return { plan: buildRenderPlan(document), renderedLayerIds };
  }

  renderLayerCollection(layers, document, context, renderedLayerIds) {
    const renderedById = new Map();
    let previousBaseId = null;
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const layerCanvas = this.renderLayer(layer, document, renderedLayerIds);
      if (!layerCanvas) continue;
      let composited = layerCanvas;
      if (layer.clipping?.enabled) {
        const baseId = layer.clipping.baseLayerId ?? previousBaseId;
        const baseCanvas = baseId ? renderedById.get(baseId) : null;
        if (baseCanvas) composited = this.applyAlphaSource(layerCanvas, baseCanvas, false, 1);
      } else {
        previousBaseId = layer.id;
      }

      context.save?.();
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = resolveCompositeOperation(layer.blendMode);
      context.drawImage(composited, 0, 0);
      context.restore?.();
      renderedById.set(layer.id, composited);
      renderedLayerIds.push(layer.id);
    }
    return renderedById;
  }

  renderLayer(layer, document, renderedLayerIds = []) {
    let canvas = this.createCanvas(document.width, document.height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    if (layer.type === 'group') {
      this.renderLayerCollection(layer.children, document, context, renderedLayerIds);
      if (!isIdentityTransform(layer.transform)) {
        const transformed = this.createCanvas(document.width, document.height);
        const transformedContext = transformed.getContext('2d');
        transformedContext.save?.();
        applyTransform(transformedContext, layer.transform);
        transformedContext.drawImage(canvas, 0, 0);
        transformedContext.restore?.();
        canvas = transformed;
      }
    } else {
      context.save?.();
      applyTransform(context, layer.transform);
      this.drawLayerContent(context, layer, document);
      context.restore?.();
    }

    if (layer.mask?.enabled && layer.mask.assetId) {
      const maskAsset = this.resolveAsset(layer.mask.assetId, document);
      if (maskAsset) return this.applyAlphaSource(canvas, maskAsset, layer.mask.inverted, layer.mask.opacity);
    }
    return canvas;
  }

  drawLayerContent(context, layer, document) {
    if (layer.type === 'raster') {
      const source = this.resolveAsset(layer.content.assetId, document);
      if (!source) return;
      const width = layer.content.width || source.width || document.width;
      const height = layer.content.height || source.height || document.height;
      context.drawImage(source, 0, 0, width, height);
      return;
    }

    if (layer.type === 'text') {
      const content = layer.content;
      context.fillStyle = content.color;
      context.font = `${content.fontWeight} ${content.fontSize}px ${content.fontFamily}`;
      context.textAlign = content.align;
      context.textBaseline = 'top';
      if (content.maxWidth > 0) context.fillText(content.text, 0, 0, content.maxWidth);
      else context.fillText(content.text, 0, 0);
      return;
    }

    if (layer.type === 'shape') drawShape(context, layer.content);
  }

  resolveAsset(assetId, document) {
    if (!assetId) return null;
    if (this.assetResolver) return this.assetResolver(assetId, document);
    return document.getRuntimeAsset?.(assetId) ?? null;
  }

  applyAlphaSource(source, maskSource, inverted = false, opacity = 1) {
    const output = this.createCanvas(source.width, source.height);
    const context = output.getContext('2d');
    context.drawImage(source, 0, 0);
    context.save?.();
    context.globalCompositeOperation = inverted ? 'destination-out' : 'destination-in';
    context.globalAlpha = Math.min(1, Math.max(0, Number(opacity) || 0));
    context.drawImage(maskSource, 0, 0, source.width, source.height);
    context.restore?.();
    return output;
  }
}

export function applyTransform(context, transform = {}) {
  const x = Number(transform.x) || 0;
  const y = Number(transform.y) || 0;
  const originX = Number(transform.originX) || 0;
  const originY = Number(transform.originY) || 0;
  const rotation = (Number(transform.rotation) || 0) * Math.PI / 180;
  const scaleX = Number.isFinite(Number(transform.scaleX)) ? Number(transform.scaleX) : 1;
  const scaleY = Number.isFinite(Number(transform.scaleY)) ? Number(transform.scaleY) : 1;
  const skewX = (Number(transform.skewX) || 0) * Math.PI / 180;
  const skewY = (Number(transform.skewY) || 0) * Math.PI / 180;
  context.translate?.(x + originX, y + originY);
  if (rotation) context.rotate?.(rotation);
  if ((skewX || skewY) && context.transform) context.transform(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
  context.scale?.(scaleX, scaleY);
  context.translate?.(-originX, -originY);
}

function isIdentityTransform(transform = {}) {
  return !Number(transform.x)
    && !Number(transform.y)
    && !Number(transform.rotation)
    && !Number(transform.skewX)
    && !Number(transform.skewY)
    && (transform.scaleX ?? 1) === 1
    && (transform.scaleY ?? 1) === 1;
}

function drawShape(context, content) {
  context.beginPath?.();
  if (content.shape === 'ellipse') {
    context.ellipse?.(content.width / 2, content.height / 2, content.width / 2, content.height / 2, 0, 0, Math.PI * 2);
  } else if (content.shape === 'line') {
    context.moveTo?.(0, 0);
    context.lineTo?.(content.width, content.height);
  } else if (content.radius > 0 && context.roundRect) {
    context.roundRect(0, 0, content.width, content.height, content.radius);
  } else {
    context.rect?.(0, 0, content.width, content.height);
  }
  if (content.fill) {
    context.fillStyle = content.fill;
    context.fill?.();
  }
  if (content.stroke && content.strokeWidth > 0) {
    context.strokeStyle = content.stroke;
    context.lineWidth = content.strokeWidth;
    context.stroke?.();
  }
}

function defaultCreateCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Brak implementacji canvasa. Przekaż createCanvas do renderera.');
}
