import { resampleStroke } from './editor-paint.js';

export const RETOUCH_TOOLS = Object.freeze(['clone', 'healing', 'spot-healing']);
export const RETOUCH_SAMPLE_MODES = Object.freeze(['current', 'all']);

export function createRetouchStroke(pointsInput, options = {}) {
  const points = normalizePoints(pointsInput);
  if (!points.length) throw new Error('Pociągnięcie retuszu nie zawiera punktów.');
  const tool = RETOUCH_TOOLS.includes(options.tool) ? options.tool : 'clone';
  const size = clamp(Number(options.size) || 36, 1, 1024);
  const spacing = clamp(Number(options.spacing) || 0.18, 0.02, 2);
  const sourceOffset = normalizeOffset(options.sourceOffset);
  if (tool !== 'spot-healing' && !sourceOffset) throw new Error('Clone stamp i healing brush wymagają ustawionego źródła.');
  return {
    id: String(options.id ?? createId('retouch')),
    tool,
    points,
    size,
    hardness: clamp(Number(options.hardness) || 0, 0, 1),
    opacity: clamp(Number(options.opacity) || 1, 0, 1),
    flow: clamp(Number(options.flow) || 1, 0.01, 1),
    spacing,
    aligned: options.aligned !== false,
    sampleMode: RETOUCH_SAMPLE_MODES.includes(options.sampleMode) ? options.sampleMode : 'all',
    sampleLayerId: options.sampleLayerId ? String(options.sampleLayerId) : null,
    sourcePoint: options.sourcePoint ? normalizePoint(options.sourcePoint) : null,
    sourceOffset,
    patchAssetId: options.patchAssetId ? String(options.patchAssetId) : null,
    bounds: options.bounds ? normalizeBounds(options.bounds) : null,
    selection: options.selection ? clone(options.selection) : null,
    createdAt: options.createdAt ?? new Date().toISOString()
  };
}

export function createRetouchLayerMetadata(strokes = []) {
  return {
    kind: 'retouch',
    version: 1,
    strokes: strokes.map(stroke => createRetouchStroke(stroke.points, stroke))
  };
}

export function isRetouchLayer(layer) {
  return Boolean(layer?.metadata?.kind === 'retouch' && Array.isArray(layer.metadata?.strokes));
}

export function normalizeRetouchLayer(layer) {
  if (!isRetouchLayer(layer)) throw new Error('Warstwa nie jest warstwą retuszu.');
  return createRetouchLayerMetadata(layer.metadata.strokes);
}

export function resolveStrokeSourceOffset({ tool, aligned, sourcePoint, destinationStart, alignedOffset = null, width, height, size = 36 } = {}) {
  const destination = normalizePoint(destinationStart);
  if (tool === 'spot-healing') return chooseSpotSourceOffset(destination, width, height, size);
  if (aligned && alignedOffset) return normalizeOffset(alignedOffset);
  const source = normalizePoint(sourcePoint);
  return { x: source.x - destination.x, y: source.y - destination.y };
}

export function chooseSpotSourceOffset(destinationInput, widthInput, heightInput, sizeInput = 36) {
  const destination = normalizePoint(destinationInput);
  const width = Math.max(1, Number(widthInput) || 1);
  const height = Math.max(1, Number(heightInput) || 1);
  const distance = Math.max(8, Number(sizeInput) * 1.75);
  const candidates = [
    { x: distance, y: 0 },
    { x: -distance, y: 0 },
    { x: 0, y: distance },
    { x: 0, y: -distance },
    { x: distance * 0.72, y: distance * 0.72 },
    { x: -distance * 0.72, y: -distance * 0.72 }
  ];
  for (const offset of candidates) {
    const x = destination.x + offset.x;
    const y = destination.y + offset.y;
    if (x >= 0 && y >= 0 && x < width && y < height) return offset;
  }
  return {
    x: clamp(width / 2 - destination.x, -distance, distance),
    y: clamp(height / 2 - destination.y, -distance, distance)
  };
}

export function retouchStampPlan(strokeInput) {
  const stroke = createRetouchStroke(strokeInput.points, strokeInput);
  const spacing = Math.max(0.5, stroke.size * stroke.spacing);
  const points = resampleStroke(stroke.points, spacing);
  return points.map(point => ({
    destination: point,
    source: {
      x: point.x + stroke.sourceOffset.x,
      y: point.y + stroke.sourceOffset.y
    },
    radius: Math.max(0.5, stroke.size * point.pressure / 2)
  }));
}

export function retouchPatchBounds(strokeInput, widthInput, heightInput) {
  const stroke = createRetouchStroke(strokeInput.points, strokeInput);
  const width = Math.max(1, Math.trunc(Number(widthInput)) || 1);
  const height = Math.max(1, Math.trunc(Number(heightInput)) || 1);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const point of stroke.points) {
    const radius = stroke.size * point.pressure / 2 + 2;
    minX = Math.min(minX, Math.floor(point.x - radius));
    minY = Math.min(minY, Math.floor(point.y - radius));
    maxX = Math.max(maxX, Math.ceil(point.x + radius));
    maxY = Math.max(maxY, Math.ceil(point.y + radius));
  }
  if (maxX < 0 || maxY < 0) return { x: 0, y: 0, width: 1, height: 1 };
  const x = clamp(minX, 0, width - 1);
  const y = clamp(minY, 0, height - 1);
  return {
    x,
    y,
    width: Math.max(1, clamp(maxX, x + 1, width) - x),
    height: Math.max(1, clamp(maxY, y + 1, height) - y)
  };
}

export function processRetouchStroke(sourceInput, widthInput, heightInput, strokeInput, selectionMask = null) {
  const width = Math.max(1, Math.trunc(Number(widthInput)) || 1);
  const height = Math.max(1, Math.trunc(Number(heightInput)) || 1);
  const source = toRgba(sourceInput, width, height);
  const stroke = createRetouchStroke(strokeInput.points, strokeInput);
  if (selectionMask && selectionMask.length !== width * height) throw new Error('Maska zaznaczenia retuszu ma nieprawidłowy rozmiar.');
  const bounds = retouchPatchBounds(stroke, width, height);
  const patch = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  const stamps = retouchStampPlan(stroke);
  for (const stamp of stamps) {
    const adaptation = stroke.tool === 'clone' ? null : healingAdaptation(source, width, height, stamp, stroke.size);
    paintStamp(patch, bounds, source, width, height, stamp, stroke, selectionMask, adaptation);
  }
  return { data: patch, bounds, stroke: { ...stroke, bounds } };
}

export function sourcePointForDestination(strokeInput, destinationInput) {
  const stroke = createRetouchStroke(strokeInput.points, strokeInput);
  const destination = normalizePoint(destinationInput);
  return { x: destination.x + stroke.sourceOffset.x, y: destination.y + stroke.sourceOffset.y };
}

function paintStamp(patch, bounds, source, width, height, stamp, stroke, selectionMask, adaptation) {
  const radius = stamp.radius;
  const left = Math.max(bounds.x, Math.floor(stamp.destination.x - radius));
  const top = Math.max(bounds.y, Math.floor(stamp.destination.y - radius));
  const right = Math.min(bounds.x + bounds.width - 1, Math.ceil(stamp.destination.x + radius));
  const bottom = Math.min(bounds.y + bounds.height - 1, Math.ceil(stamp.destination.y + radius));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x + 0.5 - stamp.destination.x, y + 0.5 - stamp.destination.y) / radius;
      if (distance >= 1) continue;
      const selection = selectionMask ? selectionMask[y * width + x] / 255 : 1;
      if (selection <= 0) continue;
      const brush = brushWeight(distance, stroke.hardness) * stroke.opacity * stroke.flow * selection;
      if (brush <= 0) continue;
      const sourceX = stamp.source.x + (x + 0.5 - stamp.destination.x);
      const sourceY = stamp.source.y + (y + 0.5 - stamp.destination.y);
      const sampled = sampleBilinear(source, width, height, sourceX, sourceY);
      if (!sampled || sampled[3] <= 0) continue;
      const candidate = stroke.tool === 'clone' ? sampled : adaptHealingPixel(sampled, adaptation);
      const patchOffset = ((y - bounds.y) * bounds.width + (x - bounds.x)) * 4;
      compositePixel(patch, patchOffset, candidate, brush);
    }
  }
}

function healingAdaptation(source, width, height, stamp, size) {
  const radius = Math.max(2, Math.min(24, size * 0.28));
  const sourceMean = localMean(source, width, height, stamp.source.x, stamp.source.y, radius);
  const destinationMean = localMean(source, width, height, stamp.destination.x, stamp.destination.y, radius);
  return {
    shift: [
      destinationMean[0] - sourceMean[0],
      destinationMean[1] - sourceMean[1],
      destinationMean[2] - sourceMean[2]
    ],
    strength: 0.86
  };
}

function adaptHealingPixel(sampled, adaptation) {
  if (!adaptation) return sampled;
  return [
    byte(sampled[0] + adaptation.shift[0] * adaptation.strength),
    byte(sampled[1] + adaptation.shift[1] * adaptation.strength),
    byte(sampled[2] + adaptation.shift[2] * adaptation.strength),
    sampled[3]
  ];
}

function localMean(source, width, height, centerX, centerY, radius) {
  const left = Math.max(0, Math.floor(centerX - radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const right = Math.min(width - 1, Math.ceil(centerX + radius));
  const bottom = Math.min(height - 1, Math.ceil(centerY + radius));
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = (y * width + x) * 4;
      if (source[offset + 3] === 0) continue;
      sums[0] += source[offset];
      sums[1] += source[offset + 1];
      sums[2] += source[offset + 2];
      count += 1;
    }
  }
  return count ? sums.map(value => value / count) : [0, 0, 0];
}

function brushWeight(distance, hardness) {
  if (hardness >= 0.999) return 1;
  const hardRadius = hardness * 0.88;
  if (distance <= hardRadius) return 1;
  const t = clamp((distance - hardRadius) / Math.max(0.001, 1 - hardRadius), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

function sampleBilinear(source, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const output = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const a = source[(y0 * width + x0) * 4 + channel];
    const b = source[(y0 * width + x1) * 4 + channel];
    const c = source[(y1 * width + x0) * 4 + channel];
    const d = source[(y1 * width + x1) * 4 + channel];
    output[channel] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  return output;
}

function compositePixel(target, offset, candidate, strength) {
  const sourceAlpha = candidate[3] / 255 * clamp(strength, 0, 1);
  const destinationAlpha = target[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = (candidate[channel] * sourceAlpha + target[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha;
    target[offset + channel] = byte(value);
  }
  target[offset + 3] = byte(outputAlpha * 255);
}

function toRgba(value, width, height) {
  const data = value?.data ?? value;
  if (!data || data.length !== width * height * 4) throw new Error('Retusz wymaga danych RGBA zgodnych z wymiarami obrazu.');
  return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
}

function normalizePoints(points) {
  return (points ?? []).map(normalizePoint);
}

function normalizePoint(point) {
  return {
    x: finite(point?.x, 0),
    y: finite(point?.y, 0),
    pressure: clamp(finite(point?.pressure, 1), 0.05, 1)
  };
}

function normalizeOffset(offset) {
  if (!offset || !Number.isFinite(Number(offset.x)) || !Number.isFinite(Number(offset.y))) return null;
  return { x: Number(offset.x), y: Number(offset.y) };
}

function normalizeBounds(bounds) {
  return {
    x: Math.trunc(finite(bounds.x, 0)),
    y: Math.trunc(finite(bounds.y, 0)),
    width: Math.max(1, Math.trunc(finite(bounds.width, 1))),
    height: Math.max(1, Math.trunc(finite(bounds.height, 1)))
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
