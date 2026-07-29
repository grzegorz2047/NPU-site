export const MODEL_SIZE = 256;
export const MODEL_ID = 'onnx-community/modnet-webnn';
export const FULL_MODEL_URL = 'https://huggingface.co/onnx-community/modnet-webnn/resolve/main/onnx/model.onnx';

export function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function rgbaToNchw(data, width, height) {
  if (!data || data.length !== width * height * 4) throw new Error('Nieprawidłowe dane obrazu.');
  const pixels = width * height;
  const output = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    output[i] = data[i * 4] / 127.5 - 1;
    output[pixels + i] = data[i * 4 + 1] / 127.5 - 1;
    output[pixels * 2 + i] = data[i * 4 + 2] / 127.5 - 1;
  }
  return output;
}

export function tensorToMask(tensor, expectedPixels = MODEL_SIZE * MODEL_SIZE) {
  const data = tensor?.data ?? tensor;
  if (!data || typeof data.length !== 'number') throw new Error('Model nie zwrócił prawidłowej maski.');
  if (data.length < expectedPixels) throw new Error(`Maska ma ${data.length} wartości, oczekiwano ${expectedPixels}.`);
  const start = data.length - expectedPixels;
  const output = new Float32Array(expectedPixels);
  for (let i = 0; i < expectedPixels; i += 1) output[i] = clamp(Number(data[start + i]));
  return output;
}

export function applyMaskAlpha(rgba, mask, { threshold = 0.5, softness = 0.18 } = {}) {
  if (!rgba || !mask || rgba.length / 4 !== mask.length) throw new Error('Maska i obraz mają różne rozmiary.');
  const output = new Uint8ClampedArray(rgba);
  for (let i = 0; i < mask.length; i += 1) {
    const alpha = alphaFromMask(mask[i], threshold, softness);
    output[i * 4 + 3] = Math.round((rgba[i * 4 + 3] / 255) * alpha * 255);
  }
  return output;
}

export function alphaFromMask(value, threshold = 0.5, softness = 0.18) {
  const mask = clamp(value);
  const edge = clamp(threshold);
  const width = Math.max(0.005, clamp(softness, 0.005, 0.5));
  const low = edge - width;
  const high = edge + width;
  if (mask <= low) return 0;
  if (mask >= high) return 1;
  const t = (mask - low) / (high - low);
  return t * t * (3 - 2 * t);
}

export function coverRect(srcW, srcH, destW, destH) {
  const srcRatio = srcW / srcH;
  const destRatio = destW / destH;
  if (srcRatio > destRatio) {
    const drawH = destH;
    const drawW = drawH * srcRatio;
    return { x: (destW - drawW) / 2, y: 0, width: drawW, height: drawH };
  }
  const drawW = destW;
  const drawH = drawW / srcRatio;
  return { x: 0, y: (destH - drawH) / 2, width: drawW, height: drawH };
}

export function scaleDimensions(width, height, maxSide = 1400) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export function computeMaskBounds(mask, width, height, threshold = 0.5) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = mask[y * width + x];
      if (value >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxY < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    coverage: ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height)
  };
}

export function filenameForDownload(sourceName = 'image', ext = 'png') {
  const base = String(sourceName || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9ąćęłńóśźż_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  return `${base}-localstudio.${ext}`;
}
