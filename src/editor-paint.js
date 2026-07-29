import { createLayerMask, createPaintLayer } from './editor-document.js';
import { addLayerCommand, createDocumentCommand } from './editor-history.js';
import { createSelection } from './editor-selection.js';

export function createBrushStroke(points, options = {}) {
  const size = clamp(Number(options.size) || 24, 1, 1024);
  const spacing = clamp(Number(options.spacing) || 0.2, 0.02, 2);
  const normalized = normalizePoints(points);
  if (!normalized.length) throw new Error('Pociągnięcie pędzla nie zawiera punktów.');
  return {
    id: options.id ?? createStrokeId(),
    tool: options.tool === 'eraser' ? 'eraser' : 'brush',
    points: simplifyPoints(normalized, Math.max(0.25, size * spacing * 0.2)),
    size,
    hardness: clamp(Number(options.hardness) || 0, 0, 1),
    opacity: clamp(Number(options.opacity) || 1, 0, 1),
    spacing,
    color: String(options.color ?? '#000000'),
    selection: options.selection ? createSelection(options.selection) : null,
    createdAt: options.createdAt ?? new Date().toISOString()
  };
}

export function resampleStroke(pointsInput, spacingInput) {
  const points = normalizePoints(pointsInput);
  if (points.length < 2) return points;
  const spacing = Math.max(0.1, Number(spacingInput) || 1);
  const output = [points[0]];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) continue;
    let position = spacing - carry;
    while (position <= distance) {
      const ratio = position / distance;
      output.push({ x: start.x + dx * ratio, y: start.y + dy * ratio, pressure: interpolate(start.pressure, end.pressure, ratio) });
      position += spacing;
    }
    carry = Math.max(0, distance - (position - spacing));
  }
  const last = points.at(-1);
  if (Math.hypot(output.at(-1).x - last.x, output.at(-1).y - last.y) > spacing * 0.25) output.push(last);
  return output;
}

export function createSolidFill(options = {}) {
  return { id: options.id ?? createStrokeId('fill'), type: 'solid', color: String(options.color ?? '#000000'), opacity: clamp(Number(options.opacity) || 1, 0, 1), selection: options.selection ? createSelection(options.selection) : null };
}

export function createGradientFill(start, end, options = {}) {
  return {
    id: options.id ?? createStrokeId('gradient'),
    type: options.type === 'radial' ? 'radial' : 'linear',
    start: normalizePoint(start),
    end: normalizePoint(end),
    colorA: String(options.colorA ?? '#000000'),
    colorB: String(options.colorB ?? '#ffffff'),
    opacity: clamp(Number(options.opacity) || 1, 0, 1),
    selection: options.selection ? createSelection(options.selection) : null
  };
}

export function createAddPaintLayerCommand(options = {}) {
  const layer = createPaintLayer({ name: options.name ?? 'Malowanie', width: options.width, height: options.height, metadata: { role: 'paint', ...(options.metadata ?? {}) } });
  return addLayerCommand(layer, options.index);
}

export function createAppendPaintStrokeCommand(layerId, strokeInput) {
  const stroke = createBrushStroke(strokeInput.points, strokeInput);
  return createDocumentCommand('Pociągnięcie pędzla', documentModel => {
    const layer = documentModel.getLayer(layerId);
    if (!layer || layer.type !== 'paint') throw new Error('Pędzel wymaga aktywnej warstwy malowania.');
    layer.content.strokes = [...layer.content.strokes, stroke];
    layer.content.operationOrder = [...(layer.content.operationOrder ?? []), stroke.id];
    documentModel.touch();
    documentModel.emit('paint:stroke', { layer, stroke });
  });
}

export function createAppendFillCommand(layerId, fill) {
  return createDocumentCommand(fill.type === 'solid' ? 'Wypełnienie' : 'Gradient', documentModel => {
    const layer = documentModel.getLayer(layerId);
    if (!layer || layer.type !== 'paint') throw new Error('Wypełnienie wymaga warstwy malowania.');
    layer.content.fills = [...layer.content.fills, clonePlain(fill)];
    layer.content.operationOrder = [...(layer.content.operationOrder ?? []), fill.id];
    documentModel.touch();
    documentModel.emit('paint:fill', { layer, fill });
  });
}

export function createAppendEraseStrokeCommand(layerId, strokeInput) {
  const stroke = createBrushStroke(strokeInput.points, { ...strokeInput, tool: 'eraser', color: '#000000' });
  return createDocumentCommand('Pociągnięcie gumki', documentModel => {
    const layer = documentModel.getLayer(layerId);
    if (!layer) throw new Error('Gumka wymaga aktywnej warstwy.');
    const mask = layer.mask ? createLayerMask(layer.mask) : createLayerMask({ enabled: true });
    mask.enabled = true;
    mask.metadata = { ...mask.metadata, eraseStrokes: [...(mask.metadata?.eraseStrokes ?? []), stroke] };
    layer.mask = mask;
    documentModel.touch();
    documentModel.emit('mask:erase-stroke', { layer, stroke });
  });
}

export function ensurePaintLayer(documentModel, history, options = {}) {
  const active = documentModel.activeLayer;
  if (active?.type === 'paint' && !active.locked) return active;
  const command = createAddPaintLayerCommand({ width: documentModel.width, height: documentModel.height, ...options });
  history.execute(command, documentModel);
  return documentModel.activeLayer;
}

function simplifyPoints(points, tolerance) {
  if (points.length <= 2) return points;
  const output = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const previous = output.at(-1);
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= tolerance) output.push(point);
  }
  output.push(points.at(-1));
  return output;
}
function normalizePoints(points) { return (points ?? []).map(normalizePoint); }
function normalizePoint(point) { return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, pressure: clamp(Number(point?.pressure) || 1, 0.05, 1) }; }
function interpolate(a, b, ratio) { return (Number(a) || 1) + ((Number(b) || 1) - (Number(a) || 1)) * ratio; }
function createStrokeId(prefix = 'stroke') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function clonePlain(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function createPaintOperationCommand(documentModel, operation, options = {}) {
  const active = documentModel.activeLayer;
  const existingLayerId = active?.type === 'paint' && !active.locked ? active.id : null;
  const layer = existingLayerId ? null : createPaintLayer({ name: options.name ?? 'Malowanie', width: documentModel.width, height: documentModel.height, metadata: { role: 'paint' } });
  const label = operation.points ? 'Pociągnięcie pędzla' : operation.type === 'solid' ? 'Wypełnienie' : 'Gradient';
  return createDocumentCommand(label, target => {
    let paintLayer = existingLayerId ? target.getLayer(existingLayerId) : null;
    if (!paintLayer) paintLayer = target.addLayer(layer);
    if (operation.points) {
      const stroke = createBrushStroke(operation.points, operation);
      paintLayer.content.strokes = [...paintLayer.content.strokes, stroke];
      paintLayer.content.operationOrder = [...(paintLayer.content.operationOrder ?? []), stroke.id];
    } else {
      paintLayer.content.fills = [...paintLayer.content.fills, clonePlain(operation)];
      paintLayer.content.operationOrder = [...(paintLayer.content.operationOrder ?? []), operation.id];
    }
    target.touch();
    target.emit(operation.points ? 'paint:stroke' : 'paint:fill', { layer: paintLayer, operation });
  });
}
