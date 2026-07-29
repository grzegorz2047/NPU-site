export function normalizeMask(maskInput, width, height) {
  const data = maskInput?.data ?? maskInput;
  if (!data || data.length !== width * height) throw new Error('Maska ma nieprawidłowy rozmiar.');
  const output = new Uint8Array(data.length);
  let maximum = 0;
  for (let index = 0; index < data.length; index += 1) maximum = Math.max(maximum, Number(data[index]) || 0);
  const scale = maximum <= 1 ? 255 : 1;
  for (let index = 0; index < data.length; index += 1) output[index] = byte((Number(data[index]) || 0) * scale);
  return output;
}

export function scaleMask(maskInput, sourceWidth, sourceHeight, targetWidth, targetHeight, { smooth = true } = {}) {
  const source = normalizeMask(maskInput, sourceWidth, sourceHeight);
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source.slice();
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * sourceHeight / targetHeight - 0.5;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5;
      output[y * targetWidth + x] = smooth
        ? bilinear(source, sourceWidth, sourceHeight, sourceX, sourceY)
        : source[clamp(Math.round(sourceY), 0, sourceHeight - 1) * sourceWidth + clamp(Math.round(sourceX), 0, sourceWidth - 1)];
    }
  }
  return output;
}

export function combineMasks(masks, width, height, mode = 'union') {
  const normalized = masks.map(mask => normalizeMask(mask, width, height));
  if (!normalized.length) return new Uint8Array(width * height);
  const output = normalized[0].slice();
  for (let maskIndex = 1; maskIndex < normalized.length; maskIndex += 1) {
    const mask = normalized[maskIndex];
    for (let index = 0; index < output.length; index += 1) {
      if (mode === 'intersect') output[index] = Math.min(output[index], mask[index]);
      else if (mode === 'subtract') output[index] = byte(output[index] * (1 - mask[index] / 255));
      else output[index] = Math.max(output[index], mask[index]);
    }
  }
  return output;
}

export function refineMask(maskInput, width, height, options = {}) {
  let output = normalizeMask(maskInput, width, height);
  const expand = Math.trunc(Number(options.expand) || 0);
  const contract = Math.trunc(Number(options.contract) || 0);
  if (expand > 0) output = dilateMask(output, width, height, Math.min(64, expand));
  if (contract > 0) output = erodeMask(output, width, height, Math.min(64, contract));
  const feather = Math.max(0, Number(options.feather) || 0);
  if (feather > 0) output = guidedFeather(output, width, height, Math.min(40, feather), options.sourceRgba);
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.5;
  const softness = Math.max(0.005, Math.min(0.5, Number(options.softness) || 0.12));
  for (let index = 0; index < output.length; index += 1) {
    const value = output[index] / 255;
    const low = threshold - softness;
    const high = threshold + softness;
    if (value <= low) output[index] = 0;
    else if (value >= high) output[index] = 255;
    else {
      const t = (value - low) / (high - low);
      output[index] = byte((t * t * (3 - 2 * t)) * 255);
    }
  }
  return output;
}

export function paintMask(maskInput, width, height, points, options = {}) {
  const output = normalizeMask(maskInput, width, height);
  const mode = options.mode === 'subtract' ? 'subtract' : 'add';
  const size = Math.max(1, Number(options.size) || 32);
  const hardness = clamp(Number(options.hardness) || 0, 0, 1);
  const opacity = clamp(Number(options.opacity) || 1, 0, 1);
  const samples = resample(points ?? [], Math.max(0.5, size * (Number(options.spacing) || 0.14)));
  for (const point of samples) {
    const radius = size * (Number(point.pressure) || 1) / 2;
    const left = Math.max(0, Math.floor(point.x - radius));
    const top = Math.max(0, Math.floor(point.y - radius));
    const right = Math.min(width - 1, Math.ceil(point.x + radius));
    const bottom = Math.min(height - 1, Math.ceil(point.y + radius));
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      const distance = Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y) / radius;
      if (distance >= 1) continue;
      const weight = brushWeight(distance, hardness) * opacity;
      const index = y * width + x;
      output[index] = mode === 'add'
        ? byte(output[index] + (255 - output[index]) * weight)
        : byte(output[index] * (1 - weight));
    }
  }
  return output;
}

export function maskBounds(maskInput, width, height, threshold = 1) {
  const mask = normalizeMask(maskInput, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (mask[y * width + x] < threshold) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    pixels += 1;
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

export function maskContains(mask, width, height, x, y, threshold = 128) {
  const px = Math.floor(Number(x));
  const py = Math.floor(Number(y));
  if (px < 0 || py < 0 || px >= width || py >= height) return false;
  return Number(mask[py * width + px]) >= threshold;
}

export function maskToFloat32(maskInput, width, height) {
  const mask = normalizeMask(maskInput, width, height);
  const output = new Float32Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) output[index] = mask[index] / 255;
  return output;
}

export function connectedComponents(maskInput, width, height, { threshold = 128, minPixels = 8 } = {}) {
  const mask = normalizeMask(maskInput, width, height);
  const visited = new Uint8Array(mask.length);
  const components = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || mask[start] < threshold) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels = [];
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || mask[neighbor] < threshold) continue;
        const nx = neighbor % width;
        const ny = Math.floor(neighbor / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (pixels.length < minPixels) continue;
    const component = new Uint8Array(mask.length);
    for (const index of pixels) component[index] = mask[index];
    components.push(component);
  }
  return components;
}

function dilateMask(source, width, height, radius) {
  let output = source.slice();
  for (let iteration = 0; iteration < radius; iteration += 1) {
    const next = output.slice();
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = output[index];
      if (x > 0) value = Math.max(value, output[index - 1]);
      if (x + 1 < width) value = Math.max(value, output[index + 1]);
      if (y > 0) value = Math.max(value, output[index - width]);
      if (y + 1 < height) value = Math.max(value, output[index + width]);
      next[index] = value;
    }
    output = next;
  }
  return output;
}

function erodeMask(source, width, height, radius) {
  let output = source.slice();
  for (let iteration = 0; iteration < radius; iteration += 1) {
    const next = output.slice();
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = output[index];
      value = Math.min(value, x > 0 ? output[index - 1] : 0);
      value = Math.min(value, x + 1 < width ? output[index + 1] : 0);
      value = Math.min(value, y > 0 ? output[index - width] : 0);
      value = Math.min(value, y + 1 < height ? output[index + width] : 0);
      next[index] = value;
    }
    output = next;
  }
  return output;
}

function guidedFeather(source, width, height, radius, rgba) {
  const output = new Uint8Array(source.length);
  const guide = rgba?.data ?? rgba;
  const integerRadius = Math.max(1, Math.round(radius));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    let total = 0;
    let weightTotal = 0;
    const center = guide && guide.length === width * height * 4 ? index * 4 : -1;
    for (let oy = -integerRadius; oy <= integerRadius; oy += 1) for (let ox = -integerRadius; ox <= integerRadius; ox += 1) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      const spatial = Math.exp(-(ox * ox + oy * oy) / Math.max(1, 2 * radius * radius));
      let edge = 1;
      if (center >= 0) {
        const offset = neighbor * 4;
        const colorDistance = Math.abs(guide[center] - guide[offset]) + Math.abs(guide[center + 1] - guide[offset + 1]) + Math.abs(guide[center + 2] - guide[offset + 2]);
        edge = Math.exp(-colorDistance / 72);
      }
      const weight = spatial * edge;
      total += source[neighbor] * weight;
      weightTotal += weight;
    }
    output[index] = byte(total / Math.max(1e-6, weightTotal));
  }
  return output;
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
      previous = {
        x: previous.x + (target.x - previous.x) * ratio,
        y: previous.y + (target.y - previous.y) * ratio,
        pressure: previous.pressure + (target.pressure - previous.pressure) * ratio
      };
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

function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
