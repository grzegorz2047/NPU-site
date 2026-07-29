export function normalizeDepthOutput(input, widthHint = 0, heightHint = 0, { invert = false } = {}) {
  const extracted = extractDepthData(input, widthHint, heightHint);
  const values = extracted.data;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) throw new Error('Model nie zwrócił prawidłowej mapy głębi.');
  const range = Math.max(1e-8, maximum - minimum);
  const output = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    let normalized = (Number(values[index]) - minimum) / range;
    if (!Number.isFinite(normalized)) normalized = 0;
    if (invert) normalized = 1 - normalized;
    output[index] = byte(normalized * 255);
  }
  return { data: output, width: extracted.width, height: extracted.height, minimum, maximum, inverted: invert };
}

export function scaleDepthMap(mapInput, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const source = normalizeByteMap(mapInput, sourceWidth, sourceHeight);
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source.slice();
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * sourceHeight / targetHeight - 0.5;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5;
      output[y * targetWidth + x] = bilinear(source, sourceWidth, sourceHeight, sourceX, sourceY);
    }
  }
  return output;
}

export function invertDepthMap(mapInput, width, height) {
  const source = normalizeByteMap(mapInput, width, height);
  const output = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) output[index] = 255 - source[index];
  return output;
}

export function sampleDepth(mapInput, width, height, x, y) {
  const source = normalizeByteMap(mapInput, width, height);
  const px = Math.min(width - 1, Math.max(0, Math.floor(Number(x) || 0)));
  const py = Math.min(height - 1, Math.max(0, Math.floor(Number(y) || 0)));
  return source[py * width + px] / 255;
}

export function depthBlurRadius(depth, focusDepth, { aperture = 8, focusRange = 0.08, maxRadius = 24 } = {}) {
  const distance = Math.abs(clamp01(depth) - clamp01(focusDepth));
  const outside = Math.max(0, distance - Math.max(0, Number(focusRange) || 0));
  const normalized = outside / Math.max(1e-6, 1 - Math.max(0, Number(focusRange) || 0));
  return Math.min(Math.max(0, Number(maxRadius) || 0), normalized * Math.max(0, Number(aperture) || 0));
}

export function depthWeights(depth, focusDepth, focusRange = 0.08) {
  const value = clamp01(depth);
  const focus = clamp01(focusDepth);
  const range = Math.max(0.001, Number(focusRange) || 0.08);
  const foreground = smoothstep(focus + range, Math.max(0, focus - range * 2), value);
  const background = smoothstep(focus - range, Math.min(1, focus + range * 2), value);
  const focused = Math.max(0, 1 - Math.min(1, Math.abs(value - focus) / range));
  return { foreground: clamp01(foreground), background: clamp01(background), focused: clamp01(focused) };
}

export function paintDepthMap(mapInput, width, height, points, options = {}) {
  const output = normalizeByteMap(mapInput, width, height).slice();
  const target = byte(clamp01(options.depth ?? 0.5) * 255);
  const size = Math.max(1, Number(options.size) || 48);
  const hardness = clamp01(options.hardness ?? 0.65);
  const opacity = clamp01(options.opacity ?? 0.65);
  const samples = resample(points ?? [], Math.max(0.5, size * (Number(options.spacing) || 0.14)));
  for (const point of samples) {
    const radius = size * clamp01(point.pressure ?? 1) / 2;
    const left = Math.max(0, Math.floor(point.x - radius));
    const top = Math.max(0, Math.floor(point.y - radius));
    const right = Math.min(width - 1, Math.ceil(point.x + radius));
    const bottom = Math.min(height - 1, Math.ceil(point.y + radius));
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) / Math.max(0.5, radius);
      if (distance >= 1) continue;
      const weight = brushWeight(distance, hardness) * opacity;
      const index = y * width + x;
      output[index] = byte(output[index] + (target - output[index]) * weight);
    }
  }
  return output;
}

export function depthMapStats(mapInput, width, height) {
  const map = normalizeByteMap(mapInput, width, height);
  let sum = 0;
  let minimum = 255;
  let maximum = 0;
  const histogram = new Uint32Array(64);
  for (const value of map) {
    sum += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    histogram[Math.min(63, Math.floor(value / 4))] += 1;
  }
  return { minimum: minimum / 255, maximum: maximum / 255, mean: sum / Math.max(1, map.length) / 255, histogram };
}

export function normalizeByteMap(mapInput, width, height) {
  const data = mapInput?.data ?? mapInput;
  if (!data || data.length !== width * height) throw new Error('Mapa głębi ma nieprawidłowy rozmiar.');
  if (data instanceof Uint8Array) return data;
  let max = 0;
  for (let index = 0; index < data.length; index += 1) max = Math.max(max, Number(data[index]) || 0);
  const scale = max <= 1 ? 255 : 1;
  const output = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) output[index] = byte((Number(data[index]) || 0) * scale);
  return output;
}

function extractDepthData(input, widthHint, heightHint) {
  const value = input?.depth ?? input?.predicted_depth ?? input?.output ?? input;
  const data = value?.data ?? value?.pixels ?? value;
  let width = Math.trunc(Number(value?.width ?? value?.dims?.at?.(-1) ?? widthHint));
  let height = Math.trunc(Number(value?.height ?? value?.dims?.at?.(-2) ?? heightHint));
  if ((!width || !height) && data?.length) {
    width = Math.max(1, Math.round(Math.sqrt(data.length)));
    height = Math.max(1, Math.round(data.length / width));
  }
  if (!data || !width || !height || data.length < width * height) throw new Error('Nie można odczytać wymiarów mapy głębi.');
  const pixels = width * height;
  if (data.length === pixels * 4 || data.length === pixels * 3) {
    const channels = data.length / pixels;
    const grayscale = new Float32Array(pixels);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * channels;
      grayscale[index] = Number(data[offset]) * 0.2126 + Number(data[offset + 1]) * 0.7152 + Number(data[offset + 2]) * 0.0722;
    }
    return { data: grayscale, width, height };
  }
  const trimmed = data.length === pixels ? data : data.slice(data.length - pixels);
  return { data: trimmed, width, height };
}

function bilinear(source, width, height, x, y) {
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clamp(x - x0, 0, 1);
  const ty = clamp(y - y0, 0, 1);
  return byte(source[y0 * width + x0] * (1 - tx) * (1 - ty) + source[y0 * width + x1] * tx * (1 - ty) + source[y1 * width + x0] * (1 - tx) * ty + source[y1 * width + x1] * tx * ty);
}

function resample(points, spacing) {
  if (!points.length) return [];
  const output = [{ ...points[0], pressure: Number(points[0].pressure) || 1 }];
  let previous = output[0];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const target = { ...points[index], pressure: Number(points[index].pressure) || 1 };
    let distance = Math.hypot(target.x - previous.x, target.y - previous.y);
    if (!distance) continue;
    while (carried + distance >= spacing) {
      const ratio = (spacing - carried) / distance;
      previous = { x: previous.x + (target.x - previous.x) * ratio, y: previous.y + (target.y - previous.y) * ratio, pressure: previous.pressure + (target.pressure - previous.pressure) * ratio };
      output.push(previous);
      distance = Math.hypot(target.x - previous.x, target.y - previous.y);
      carried = 0;
    }
    carried += distance;
    previous = target;
  }
  const last = points.at(-1);
  if (output.at(-1).x !== last.x || output.at(-1).y !== last.y) output.push({ ...last, pressure: Number(last.pressure) || 1 });
  return output;
}

function brushWeight(distance, hardness) {
  if (hardness >= 0.999) return 1;
  const hard = hardness * 0.9;
  if (distance <= hard) return 1;
  const t = clamp((distance - hard) / Math.max(0.001, 1 - hard), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
function smoothstep(edge0, edge1, value) { if (edge0 === edge1) return value < edge0 ? 0 : 1; const t = clamp((value - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); }
function clamp01(value) { return clamp(Number(value) || 0, 0, 1); }
function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
