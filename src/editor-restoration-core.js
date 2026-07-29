export const RESTORATION_TASKS = Object.freeze(['super-resolution', 'denoise', 'jpeg-restoration', 'deblur']);

export const RESTORATION_PROFILES = Object.freeze({
  'sr-2x-fast': Object.freeze({ id: 'sr-2x-fast', task: 'super-resolution', label: 'Super-resolution 2× · szybki', modelId: 'swin2sr-lightweight-x2', scale: 2, modelOutputScale: 2, localFallback: 'super-resolution' }),
  'sr-4x-quality': Object.freeze({ id: 'sr-4x-quality', task: 'super-resolution', label: 'Super-resolution 4× · jakość', modelId: 'swin2sr-realworld-x4', scale: 4, modelOutputScale: 4, localFallback: 'super-resolution' }),
  'jpeg-quality': Object.freeze({ id: 'jpeg-quality', task: 'jpeg-restoration', label: 'Redukcja artefaktów JPEG · AI', modelId: 'swin2sr-compressed-x4', scale: 1, modelOutputScale: 4, preserveSize: true, localFallback: 'jpeg-restoration' }),
  'denoise-local': Object.freeze({ id: 'denoise-local', task: 'denoise', label: 'Odszumianie lokalne', modelId: null, scale: 1, modelOutputScale: 1, localFallback: 'denoise' }),
  'deblur-local': Object.freeze({ id: 'deblur-local', task: 'deblur', label: 'Redukcja lekkiego poruszenia', modelId: null, scale: 1, modelOutputScale: 1, localFallback: 'deblur' })
});

export function normalizeRestorationOptions(input = {}) {
  const profile = RESTORATION_PROFILES[input.profileId] ?? RESTORATION_PROFILES['sr-2x-fast'];
  return {
    profileId: profile.id,
    task: profile.task,
    modelId: profile.modelId,
    scale: profile.scale,
    modelOutputScale: profile.modelOutputScale,
    preserveSize: Boolean(profile.preserveSize),
    strength: clamp(Number(input.strength ?? 0.55), 0, 1),
    sharpen: clamp(Number(input.sharpen ?? 0.2), 0, 1),
    tileSize: integerInRange(input.tileSize ?? 256, 64, 1024),
    overlap: integerInRange(input.overlap ?? 24, 0, 255),
    allowLocalFallback: input.allowLocalFallback !== false,
    quality: ['fast', 'balanced', 'quality'].includes(input.quality) ? input.quality : 'balanced'
  };
}

export function createPreviewRegion(width, height, bounds = null, { size = 256 } = {}) {
  width = positiveInteger(width, 'width');
  height = positiveInteger(height, 'height');
  size = positiveInteger(size, 'size');
  const targetWidth = Math.min(width, Math.max(1, Math.round(bounds?.width || size)));
  const targetHeight = Math.min(height, Math.max(1, Math.round(bounds?.height || size)));
  const centerX = Number.isFinite(Number(bounds?.x)) ? Number(bounds.x) + targetWidth / 2 : width / 2;
  const centerY = Number.isFinite(Number(bounds?.y)) ? Number(bounds.y) + targetHeight / 2 : height / 2;
  const x = clamp(Math.round(centerX - targetWidth / 2), 0, width - targetWidth);
  const y = clamp(Math.round(centerY - targetHeight / 2), 0, height - targetHeight);
  return { x, y, width: targetWidth, height: targetHeight };
}

export function createScaledTilePlan(width, height, { tileSize = 256, overlap = 24, scale = 1 } = {}) {
  width = positiveInteger(width, 'width');
  height = positiveInteger(height, 'height');
  tileSize = positiveInteger(tileSize, 'tileSize');
  scale = positiveInteger(scale, 'scale');
  overlap = Math.max(0, Math.trunc(Number(overlap)) || 0);
  if (overlap * 2 >= tileSize) throw new Error('Overlap musi być mniejszy niż połowa rozmiaru kafelka.');
  const step = tileSize - overlap * 2;
  const xs = tilePositions(width, tileSize, step);
  const ys = tilePositions(height, tileSize, step);
  const tiles = [];
  let index = 0;
  for (const y of ys) {
    for (const x of xs) {
      const tileWidth = Math.min(tileSize, width - x);
      const tileHeight = Math.min(tileSize, height - y);
      const crop = {
        left: x === 0 ? 0 : overlap,
        top: y === 0 ? 0 : overlap,
        right: x + tileWidth >= width ? 0 : overlap,
        bottom: y + tileHeight >= height ? 0 : overlap
      };
      tiles.push({
        index: index++, x, y, width: tileWidth, height: tileHeight, crop,
        output: {
          x: x * scale, y: y * scale, width: tileWidth * scale, height: tileHeight * scale,
          crop: Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, value * scale]))
        }
      });
    }
  }
  return { width, height, outputWidth: width * scale, outputHeight: height * scale, tileSize, overlap, scale, tiles };
}

export function stitchScaledRgbaTiles(plan, outputs) {
  if (!plan?.tiles || !Array.isArray(outputs) || outputs.length !== plan.tiles.length) throw new Error('Niekompletny zestaw kafelków restoration.');
  const pixelCount = plan.outputWidth * plan.outputHeight;
  const sums = new Float64Array(pixelCount * 4);
  const weights = new Float64Array(pixelCount);
  for (let tileIndex = 0; tileIndex < plan.tiles.length; tileIndex += 1) {
    const tile = plan.tiles[tileIndex];
    const output = outputs[tileIndex];
    const data = output?.data ?? output;
    const width = output?.width ?? tile.output.width;
    const height = output?.height ?? tile.output.height;
    if (width !== tile.output.width || height !== tile.output.height || data?.length !== width * height * 4) throw new Error(`Kafelek ${tileIndex} ma nieprawidłowy rozmiar wyjścia.`);
    for (let ty = 0; ty < height; ty += 1) {
      const wy = edgeWeight(ty, height, tile.output.crop.top, tile.output.crop.bottom);
      for (let tx = 0; tx < width; tx += 1) {
        const wx = edgeWeight(tx, width, tile.output.crop.left, tile.output.crop.right);
        const weight = Math.max(1e-6, wx * wy);
        const destinationPixel = (tile.output.y + ty) * plan.outputWidth + tile.output.x + tx;
        const sourcePixel = ty * width + tx;
        weights[destinationPixel] += weight;
        for (let channel = 0; channel < 4; channel += 1) sums[destinationPixel * 4 + channel] += Number(data[sourcePixel * 4 + channel]) * weight;
      }
    }
  }
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const weight = weights[pixel] || 1;
    for (let channel = 0; channel < 4; channel += 1) data[pixel * 4 + channel] = Math.round(sums[pixel * 4 + channel] / weight);
  }
  return { data, width: plan.outputWidth, height: plan.outputHeight };
}

export function extractRgbaTile(source, width, height, tile) {
  if (!source || source.length !== width * height * 4) throw new Error('Nieprawidłowy bufor wejściowy.');
  const data = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let y = 0; y < tile.height; y += 1) {
    const start = ((tile.y + y) * width + tile.x) * 4;
    data.set(source.subarray(start, start + tile.width * 4), y * tile.width * 4);
  }
  return { data, width: tile.width, height: tile.height };
}

export function applyLocalRestoration(source, width, height, options = {}, signal = null) {
  const normalized = normalizeRestorationOptions(options);
  assertRgba(source, width, height);
  throwIfAborted(signal);
  let result;
  if (normalized.task === 'super-resolution') {
    result = resizeRgbaBilinear(source, width, height, width * normalized.scale, height * normalized.scale, signal);
    if (normalized.sharpen > 0) result.data = unsharpMask(result.data, result.width, result.height, normalized.sharpen * 0.8, signal);
  } else if (normalized.task === 'denoise') {
    result = { data: denoiseRgba(source, width, height, normalized.strength, signal), width, height };
  } else if (normalized.task === 'jpeg-restoration') {
    result = { data: restoreJpegRgba(source, width, height, normalized.strength, signal), width, height };
  } else if (normalized.task === 'deblur') {
    result = { data: unsharpMask(source, width, height, 0.4 + normalized.strength * 1.6, signal), width, height };
  } else throw new Error(`Nieobsługiwane zadanie restoration: ${normalized.task}`);
  return { ...result, task: normalized.task, profileId: normalized.profileId, backend: 'local' };
}

export function resizeRgbaBilinear(source, width, height, targetWidth, targetHeight, signal = null) {
  assertRgba(source, width, height);
  targetWidth = positiveInteger(targetWidth, 'targetWidth');
  targetHeight = positiveInteger(targetHeight, 'targetHeight');
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    const sourceY = Math.max(0, Math.min(height - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sourceY), y1 = Math.min(height - 1, y0 + 1), fy = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(width - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sourceX), x1 = Math.min(width - 1, x0 + 1), fx = sourceX - x0;
      const destination = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source[(y0 * width + x0) * 4 + channel] * (1 - fx) + source[(y0 * width + x1) * 4 + channel] * fx;
        const bottom = source[(y1 * width + x0) * 4 + channel] * (1 - fx) + source[(y1 * width + x1) * 4 + channel] * fx;
        output[destination + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { data: output, width: targetWidth, height: targetHeight };
}

export function denoiseRgba(source, width, height, strength = 0.5, signal = null) {
  assertRgba(source, width, height);
  strength = clamp(Number(strength), 0, 1);
  if (strength <= 0) return new Uint8ClampedArray(source);
  const radius = strength > 0.66 ? 2 : 1;
  const output = new Uint8ClampedArray(source.length);
  const colorThreshold = 18 + strength * 70;
  for (let y = 0; y < height; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    for (let x = 0; x < width; x += 1) {
      const centerOffset = (y * width + x) * 4;
      let weightSum = 0;
      const sums = [0, 0, 0];
      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = clamp(y + oy, 0, height - 1);
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = clamp(x + ox, 0, width - 1);
          const offset = (sy * width + sx) * 4;
          const difference = (Math.abs(source[offset] - source[centerOffset]) + Math.abs(source[offset + 1] - source[centerOffset + 1]) + Math.abs(source[offset + 2] - source[centerOffset + 2])) / 3;
          const spatial = 1 / (1 + ox * ox + oy * oy);
          const color = Math.max(0.05, 1 - difference / colorThreshold);
          const weight = spatial * color;
          weightSum += weight;
          sums[0] += source[offset] * weight;
          sums[1] += source[offset + 1] * weight;
          sums[2] += source[offset + 2] * weight;
        }
      }
      for (let channel = 0; channel < 3; channel += 1) {
        const filtered = sums[channel] / weightSum;
        output[centerOffset + channel] = Math.round(source[centerOffset + channel] * (1 - strength) + filtered * strength);
      }
      output[centerOffset + 3] = source[centerOffset + 3];
    }
  }
  return output;
}

export function restoreJpegRgba(source, width, height, strength = 0.5, signal = null) {
  const smoothed = denoiseRgba(source, width, height, clamp(strength * 0.72, 0, 0.8), signal);
  const sharpened = unsharpMask(smoothed, width, height, 0.25 + strength * 0.65, signal);
  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < output.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) output[index + channel] = Math.round(sharpened[index + channel] * (0.65 + strength * 0.2) + source[index + channel] * (0.35 - strength * 0.2));
    output[index + 3] = source[index + 3];
  }
  return output;
}

export function unsharpMask(source, width, height, amount = 1, signal = null) {
  assertRgba(source, width, height);
  amount = clamp(Number(amount), 0, 3);
  if (!amount) return new Uint8ClampedArray(source);
  const blurred = boxBlur3(source, width, height, signal);
  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < output.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) output[index + channel] = clamp(Math.round(source[index + channel] + (source[index + channel] - blurred[index + channel]) * amount), 0, 255);
    output[index + 3] = source[index + 3];
  }
  return output;
}

export function differenceRgba(before, after) {
  if (!before || !after || before.length !== after.length) throw new Error('Porównanie wymaga buforów o tym samym rozmiarze.');
  const output = new Uint8ClampedArray(before.length);
  for (let index = 0; index < output.length; index += 4) {
    output[index] = Math.min(255, Math.abs(after[index] - before[index]) * 4);
    output[index + 1] = Math.min(255, Math.abs(after[index + 1] - before[index + 1]) * 4);
    output[index + 2] = Math.min(255, Math.abs(after[index + 2] - before[index + 2]) * 4);
    output[index + 3] = 255;
  }
  return output;
}

export function estimateRestorationMemory(width, height, { scale = 1, tileSize = 256 } = {}) {
  width = positiveInteger(width, 'width');
  height = positiveInteger(height, 'height');
  scale = positiveInteger(scale, 'scale');
  tileSize = positiveInteger(tileSize, 'tileSize');
  const outputBytes = width * height * scale * scale * 4;
  const tileBytes = tileSize * tileSize * Math.max(1, scale * scale) * 4;
  return { outputBytes, tileBytes, peakBytes: outputBytes + tileBytes * 3, megapixels: width * height * scale * scale / 1_000_000 };
}

function boxBlur3(source, width, height, signal) {
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0, count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          const sy = clamp(y + oy, 0, height - 1);
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = clamp(x + ox, 0, width - 1);
            sum += source[(sy * width + sx) * 4 + channel];
            count += 1;
          }
        }
        output[destination + channel] = Math.round(sum / count);
      }
      output[destination + 3] = source[destination + 3];
    }
  }
  return output;
}

function tilePositions(length, tileSize, step) {
  if (length <= tileSize) return [0];
  const result = [];
  for (let position = 0; position < length; position += step) {
    const bounded = Math.min(position, length - tileSize);
    if (result.at(-1) !== bounded) result.push(bounded);
    if (bounded + tileSize >= length) break;
  }
  return result;
}

function edgeWeight(position, length, leading, trailing) {
  if (leading > 0 && position < leading) return smooth((position + 1) / (leading + 1));
  const trailingStart = length - trailing;
  if (trailing > 0 && position >= trailingStart) return smooth((length - position) / (trailing + 1));
  return 1;
}
function smooth(value) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function assertRgba(source, width, height) { if (!source || source.length !== width * height * 4) throw new Error('Bufor RGBA ma nieprawidłowy rozmiar.'); }
function positiveInteger(value, label) { const number = Math.trunc(Number(value)); if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} musi być dodatnią liczbą całkowitą.`); return number; }
function integerInRange(value, min, max) { const number = Math.trunc(Number(value)); return clamp(Number.isFinite(number) ? number : min, min, max); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function throwIfAborted(signal) { if (signal?.aborted) throw new DOMException(String(signal.reason || 'Operacja anulowana.'), 'AbortError'); }
