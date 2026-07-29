export const SELECTION_OPERATIONS = Object.freeze(['replace', 'add', 'subtract', 'intersect']);
export const SELECTION_SHAPES = Object.freeze(['rectangle', 'ellipse', 'polygon', 'freehand', 'raster']);

export function createSelection(options = {}) {
  return {
    version: 1,
    width: dimension(options.width, 1),
    height: dimension(options.height, 1),
    entries: (options.entries ?? []).map(normalizeEntry),
    inverted: Boolean(options.inverted)
  };
}

export function rectangleSelection(rect) {
  const value = normalizeRect(rect);
  return { type: 'rectangle', ...value };
}

export function ellipseSelection(rect) {
  const value = normalizeRect(rect);
  return { type: 'ellipse', ...value };
}

export function polygonSelection(points, type = 'polygon') {
  if (!['polygon', 'freehand'].includes(type)) type = 'polygon';
  const normalized = normalizePoints(points);
  if (normalized.length < 3) throw new Error('Zaznaczenie wielokątne wymaga co najmniej trzech punktów.');
  return { type, points: normalized };
}

export function rasterSelection(mask, width, height) {
  const normalizedWidth = dimension(width, 1);
  const normalizedHeight = dimension(height, 1);
  if (!mask || mask.length !== normalizedWidth * normalizedHeight) throw new Error('Maska zaznaczenia ma nieprawidłowy rozmiar.');
  return { type: 'raster', width: normalizedWidth, height: normalizedHeight, runs: encodeMaskRuns(mask) };
}

export function combineSelection(selectionInput, shape, operation = 'replace') {
  const selection = createSelection(selectionInput);
  const normalizedOperation = SELECTION_OPERATIONS.includes(operation) ? operation : 'replace';
  const entry = normalizeEntry({ operation: normalizedOperation, shape });
  if (normalizedOperation === 'replace') selection.entries = [entry];
  else selection.entries.push(entry);
  selection.inverted = false;
  return selection;
}

export function clearSelection(selectionInput) {
  const selection = createSelection(selectionInput);
  selection.entries = [];
  selection.inverted = false;
  return selection;
}

export function invertSelection(selectionInput) {
  const selection = createSelection(selectionInput);
  selection.inverted = !selection.inverted;
  return selection;
}

export function rasterizeSelection(selectionInput, widthInput = null, heightInput = null) {
  const selection = createSelection(selectionInput);
  const width = dimension(widthInput ?? selection.width, selection.width);
  const height = dimension(heightInput ?? selection.height, selection.height);
  if (!selection.entries.length) return new Uint8ClampedArray(width * height).fill(selection.inverted ? 255 : 0);
  let mask = new Uint8ClampedArray(width * height);
  let initialized = false;
  for (const entry of selection.entries) {
    const shapeMask = rasterizeShape(entry.shape, width, height);
    if (!initialized || entry.operation === 'replace') {
      mask = shapeMask;
      initialized = true;
      continue;
    }
    for (let index = 0; index < mask.length; index += 1) {
      const current = mask[index];
      const next = shapeMask[index];
      if (entry.operation === 'add') mask[index] = Math.max(current, next);
      else if (entry.operation === 'subtract') mask[index] = Math.round(current * (255 - next) / 255);
      else if (entry.operation === 'intersect') mask[index] = Math.min(current, next);
    }
  }
  if (selection.inverted) for (let index = 0; index < mask.length; index += 1) mask[index] = 255 - mask[index];
  return mask;
}

export function featherSelection(selectionInput, radiusInput) {
  const selection = createSelection(selectionInput);
  const radius = Math.max(0, Math.round(Number(radiusInput) || 0));
  if (!radius) return selection;
  let mask = rasterizeSelection(selection);
  for (let pass = 0; pass < 3; pass += 1) mask = boxBlur(mask, selection.width, selection.height, radius);
  return createSelection({ width: selection.width, height: selection.height, entries: [{ operation: 'replace', shape: rasterSelection(mask, selection.width, selection.height) }] });
}

export function expandSelection(selectionInput, radiusInput) {
  return morphologySelection(selectionInput, Math.max(0, Math.round(Number(radiusInput) || 0)), 'expand');
}

export function contractSelection(selectionInput, radiusInput) {
  return morphologySelection(selectionInput, Math.max(0, Math.round(Number(radiusInput) || 0)), 'contract');
}

export function selectionContains(selectionInput, xInput, yInput) {
  const selection = createSelection(selectionInput);
  if (!selection.entries.length) return true;
  const x = Math.floor(Number(xInput));
  const y = Math.floor(Number(yInput));
  if (x < 0 || y < 0 || x >= selection.width || y >= selection.height) return false;
  return rasterizeSelection(selection)[y * selection.width + x] >= 128;
}

export function selectionBounds(selectionInput) {
  const selection = createSelection(selectionInput);
  const mask = rasterizeSelection(selection);
  let minX = selection.width;
  let minY = selection.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      if (mask[y * selection.width + x] < 1) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function magicWandSelection(imageData, widthInput, heightInput, startPoint, toleranceInput = 24, options = {}) {
  const width = dimension(widthInput, 1);
  const height = dimension(heightInput, 1);
  const data = imageData?.data ?? imageData;
  if (!data || data.length < width * height * 4) throw new Error('Magic wand wymaga danych RGBA.');
  const startX = clamp(Math.floor(Number(startPoint?.x) || 0), 0, width - 1);
  const startY = clamp(Math.floor(Number(startPoint?.y) || 0), 0, height - 1);
  const startIndex = (startY * width + startX) * 4;
  const target = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]];
  const tolerance = clamp(Number(toleranceInput) || 0, 0, 255);
  const antiAlias = options.antiAlias !== false;
  const contiguous = options.contiguous !== false;
  const mask = new Uint8ClampedArray(width * height);
  const alphaFor = pixelIndex => {
    const offset = pixelIndex * 4;
    const dr = data[offset] - target[0];
    const dg = data[offset + 1] - target[1];
    const db = data[offset + 2] - target[2];
    const da = data[offset + 3] - target[3];
    const distance = Math.sqrt((dr * dr + dg * dg + db * db + da * da) / 4);
    if (distance <= tolerance) return 255;
    if (!antiAlias || tolerance >= 255) return 0;
    const fringe = Math.max(4, tolerance * 0.35);
    return distance <= tolerance + fringe ? Math.round(255 * (1 - (distance - tolerance) / fringe)) : 0;
  };
  if (!contiguous) {
    for (let index = 0; index < mask.length; index += 1) mask[index] = alphaFor(index);
    return rasterSelection(mask, width, height);
  }
  const queue = new Int32Array(width * height);
  const seen = new Uint8Array(width * height);
  let read = 0;
  let write = 0;
  queue[write++] = startY * width + startX;
  seen[startY * width + startX] = 1;
  while (read < write) {
    const index = queue[read++];
    const alpha = alphaFor(index);
    if (!alpha) continue;
    mask[index] = alpha;
    const x = index % width;
    const y = Math.floor(index / width);
    for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
      if (next >= 0 && !seen[next]) { seen[next] = 1; queue[write++] = next; }
    }
  }
  return rasterSelection(mask, width, height);
}

export function encodeMaskRuns(mask) {
  const runs = [];
  if (!mask?.length) return runs;
  let value = clamp(Math.round(mask[0]), 0, 255);
  let length = 1;
  for (let index = 1; index < mask.length; index += 1) {
    const next = clamp(Math.round(mask[index]), 0, 255);
    if (next === value && length < 65535) length += 1;
    else { runs.push([length, value]); value = next; length = 1; }
  }
  runs.push([length, value]);
  return runs;
}

export function decodeMaskRuns(runs, lengthInput) {
  const length = Math.max(0, Math.round(Number(lengthInput) || 0));
  const output = new Uint8ClampedArray(length);
  let offset = 0;
  for (const run of runs ?? []) {
    const count = Math.max(0, Math.round(Number(run?.[0]) || 0));
    const value = clamp(Math.round(Number(run?.[1]) || 0), 0, 255);
    output.fill(value, offset, Math.min(length, offset + count));
    offset += count;
    if (offset >= length) break;
  }
  return output;
}

function rasterizeShape(shape, width, height) {
  if (shape.type === 'raster') {
    const decoded = decodeMaskRuns(shape.runs, shape.width * shape.height);
    if (shape.width === width && shape.height === height) return decoded;
    const scaled = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(shape.width - 1, Math.floor(x * shape.width / width));
      const sourceY = Math.min(shape.height - 1, Math.floor(y * shape.height / height));
      scaled[y * width + x] = decoded[sourceY * shape.width + sourceX];
    }
    return scaled;
  }
  const output = new Uint8ClampedArray(width * height);
  const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let inside = 0;
    for (const sample of samples) if (shapeContains(shape, x + sample[0], y + sample[1])) inside += 1;
    output[y * width + x] = Math.round(255 * inside / samples.length);
  }
  return output;
}

function shapeContains(shape, x, y) {
  if (shape.type === 'rectangle') return x >= shape.x && y >= shape.y && x <= shape.x + shape.width && y <= shape.y + shape.height;
  if (shape.type === 'ellipse') {
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    if (!rx || !ry) return false;
    const dx = (x - shape.x - rx) / rx;
    const dy = (y - shape.y - ry) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.type === 'polygon' || shape.type === 'freehand') return pointInPolygon(shape.points, x, y);
  return false;
}

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

function morphologySelection(selectionInput, radius, mode) {
  const selection = createSelection(selectionInput);
  if (!radius) return selection;
  const source = rasterizeSelection(selection);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < selection.height; y += 1) for (let x = 0; x < selection.width; x += 1) {
    let value = mode === 'expand' ? 0 : 255;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const sampleX = x + dx;
      const sampleY = y + dy;
      const sample = sampleX < 0 || sampleY < 0 || sampleX >= selection.width || sampleY >= selection.height ? 0 : source[sampleY * selection.width + sampleX];
      value = mode === 'expand' ? Math.max(value, sample) : Math.min(value, sample);
    }
    output[y * selection.width + x] = value;
  }
  return createSelection({ width: selection.width, height: selection.height, entries: [{ operation: 'replace', shape: rasterSelection(output, selection.width, selection.height) }] });
}

function boxBlur(source, width, height, radius) {
  const horizontal = new Uint8ClampedArray(source.length);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[y * width + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = Math.round(sum / (radius * 2 + 1));
      sum += source[y * width + clamp(x + radius + 1, 0, width - 1)] - source[y * width + clamp(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = Math.round(sum / (radius * 2 + 1));
      sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x] - horizontal[clamp(y - radius, 0, height - 1) * width + x];
    }
  }
  return output;
}

function normalizeEntry(entry) {
  return { operation: SELECTION_OPERATIONS.includes(entry?.operation) ? entry.operation : 'replace', shape: normalizeShape(entry?.shape ?? entry) };
}
function normalizeShape(shape) {
  if (!shape || !SELECTION_SHAPES.includes(shape.type)) throw new Error('Nieobsługiwany typ zaznaczenia.');
  if (shape.type === 'rectangle') return rectangleSelection(shape);
  if (shape.type === 'ellipse') return ellipseSelection(shape);
  if (shape.type === 'polygon' || shape.type === 'freehand') return polygonSelection(shape.points, shape.type);
  return { type: 'raster', width: dimension(shape.width, 1), height: dimension(shape.height, 1), runs: (shape.runs ?? []).map(run => [Math.max(0, Math.round(Number(run?.[0]) || 0)), clamp(Math.round(Number(run?.[1]) || 0), 0, 255)]) };
}
function normalizeRect(rect = {}) {
  const x1 = Number(rect.x) || 0;
  const y1 = Number(rect.y) || 0;
  const x2 = x1 + (Number(rect.width) || 0);
  const y2 = y1 + (Number(rect.height) || 0);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
function normalizePoints(points) { return (points ?? []).map(point => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 })); }
function dimension(value, fallback) { const number = Math.round(Number(value)); return Number.isFinite(number) && number > 0 ? number : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
