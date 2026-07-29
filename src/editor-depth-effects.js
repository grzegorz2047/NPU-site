import { createTilePlan } from './editor-tiling.js';
import { depthBlurRadius, depthWeights, normalizeByteMap } from './editor-depth-map.js';

export const DEPTH_EFFECT_TYPES = Object.freeze(['lens-blur', 'relight', 'atmosphere']);

export function createDepthEffect(type = 'lens-blur', parameters = {}) {
  if (!DEPTH_EFFECT_TYPES.includes(type)) throw new Error(`Nieobsługiwany efekt głębi: ${type}`);
  return { version: 1, type, parameters: normalizeEffectParameters(type, parameters) };
}

export function normalizeEffectParameters(type, parameters = {}) {
  if (type === 'lens-blur') return {
    focusDepth: clamp01(parameters.focusDepth ?? 0.5), aperture: clamp(Number(parameters.aperture) || 10, 0, 30), focusRange: clamp(Number(parameters.focusRange) || 0.08, 0.005, 0.5),
    bokeh: clamp(Number(parameters.bokeh) || 0, 0, 1), maxRadius: clamp(Number(parameters.maxRadius) || 18, 0, 40), depthBins: clamp(Math.round(Number(parameters.depthBins) || 6), 3, 12)
  };
  if (type === 'relight') return {
    focusDepth: clamp01(parameters.focusDepth ?? 0.5), focusRange: clamp(Number(parameters.focusRange) || 0.08, 0.005, 0.5),
    foregroundExposure: clamp(Number(parameters.foregroundExposure) || 0, -2, 2), backgroundExposure: clamp(Number(parameters.backgroundExposure) || 0, -2, 2),
    warmth: clamp(Number(parameters.warmth) || 0, -1, 1), contrast: clamp(Number(parameters.contrast) || 0, -1, 1)
  };
  return {
    density: clamp(Number(parameters.density) || 0.18, 0, 1), startDepth: clamp01(parameters.startDepth ?? 0.48), color: normalizeColor(parameters.color ?? [210, 225, 238]),
    lightStrength: clamp(Number(parameters.lightStrength) || 0, 0, 1), lightDepth: clamp01(parameters.lightDepth ?? 0.65)
  };
}

export function applyDepthEffect(sourceInput, depthInput, width, height, effectInput) {
  const source = toRgba(sourceInput, width, height);
  const depth = normalizeByteMap(depthInput, width, height);
  const effect = createDepthEffect(effectInput.type, effectInput.parameters);
  if (effect.type === 'lens-blur') return applyLensBlur(source, depth, width, height, effect.parameters);
  if (effect.type === 'relight') return applyRelight(source, depth, width, height, effect.parameters);
  return applyAtmosphere(source, depth, width, height, effect.parameters);
}

export function applyDepthEffectTiled(sourceInput, depthInput, width, height, effectInput, options = {}) {
  const source = toRgba(sourceInput, width, height);
  const depth = normalizeByteMap(depthInput, width, height);
  const effect = createDepthEffect(effectInput.type, effectInput.parameters);
  const maximumRadius = effect.type === 'lens-blur' ? Math.ceil(effect.parameters.maxRadius) : 2;
  const tileSize = Math.max(64, Math.trunc(Number(options.tileSize) || 384));
  const overlap = Math.max(maximumRadius + 2, Math.trunc(Number(options.overlap) || maximumRadius + 8));
  if (width <= tileSize && height <= tileSize) return applyDepthEffect(source, depth, width, height, effect);
  const plan = createTilePlan(width, height, { tileSize, overlap: Math.min(overlap, Math.floor(tileSize / 3)) });
  const output = new Float64Array(source.length);
  const weights = new Float64Array(width * height);
  for (const tile of plan.tiles) {
    const rgbaTile = extractRgba(source, width, tile);
    const depthTile = extractMono(depth, width, tile);
    const processed = applyDepthEffect(rgbaTile, depthTile, tile.width, tile.height, effect);
    blendTile(output, weights, width, height, processed, tile, overlap);
  }
  const result = new Uint8ClampedArray(source.length);
  for (let pixel = 0; pixel < weights.length; pixel += 1) {
    const weight = Math.max(1e-8, weights[pixel]);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) result[offset + channel] = byte(output[offset + channel] / weight);
  }
  return result;
}

export function applyLensBlur(source, depth, width, height, parameters) {
  const radii = [0, 2, 4, 8, 12, 18, 26, 40].filter(radius => radius <= parameters.maxRadius);
  if (radii.at(-1) !== parameters.maxRadius) radii.push(parameters.maxRadius);
  const bins = Math.max(3, parameters.depthBins);
  const blurredByBin = [];
  for (let bin = 0; bin < bins; bin += 1) {
    const center = bin / Math.max(1, bins - 1);
    const mask = new Float32Array(depth.length);
    for (let index = 0; index < depth.length; index += 1) {
      const difference = Math.abs(depth[index] / 255 - center);
      mask[index] = Math.max(0, 1 - difference * (bins - 1) * 1.35);
    }
    blurredByBin.push(radii.map(radius => weightedBoxBlur(source, mask, width, height, Math.round(radius), parameters.bokeh)));
  }
  const output = new Uint8ClampedArray(source.length);
  for (let pixel = 0; pixel < depth.length; pixel += 1) {
    const depthValue = depth[pixel] / 255;
    const radius = depthBlurRadius(depthValue, parameters.focusDepth, parameters);
    const binPosition = depthValue * (bins - 1);
    const lowBin = Math.floor(binPosition);
    const highBin = Math.min(bins - 1, lowBin + 1);
    const binMix = binPosition - lowBin;
    const level = radiusLevel(radii, radius);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const low = interpolateRadius(blurredByBin[lowBin], level, offset, channel);
      const high = interpolateRadius(blurredByBin[highBin], level, offset, channel);
      output[offset + channel] = byte(low + (high - low) * binMix);
    }
  }
  return output;
}

export function applyRelight(source, depth, width, height, parameters) {
  const output = new Uint8ClampedArray(source.length);
  for (let pixel = 0; pixel < depth.length; pixel += 1) {
    const weights = depthWeights(depth[pixel] / 255, parameters.focusDepth, parameters.focusRange);
    const stops = parameters.foregroundExposure * weights.foreground + parameters.backgroundExposure * weights.background;
    const exposure = 2 ** stops;
    const warmth = parameters.warmth * (weights.foreground * 0.6 + weights.background * 0.35);
    const contrast = 1 + parameters.contrast * 0.65;
    const offset = pixel * 4;
    const channels = [source[offset] + warmth * 28, source[offset + 1] + warmth * 5, source[offset + 2] - warmth * 25];
    for (let channel = 0; channel < 3; channel += 1) output[offset + channel] = byte((channels[channel] * exposure - 128) * contrast + 128);
    output[offset + 3] = source[offset + 3];
  }
  return output;
}

export function applyAtmosphere(source, depth, width, height, parameters) {
  const output = new Uint8ClampedArray(source.length);
  const start = parameters.startDepth;
  for (let pixel = 0; pixel < depth.length; pixel += 1) {
    const value = depth[pixel] / 255;
    const fog = clamp((value - start) / Math.max(1e-6, 1 - start), 0, 1) ** 1.35 * parameters.density;
    const light = Math.exp(-((value - parameters.lightDepth) ** 2) / 0.025) * parameters.lightStrength;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const fogged = source[offset + channel] + (parameters.color[channel] - source[offset + channel]) * fog;
      output[offset + channel] = byte(fogged + light * 42);
    }
    output[offset + 3] = source[offset + 3];
  }
  return output;
}

function weightedBoxBlur(source, mask, width, height, radius, bokeh) {
  if (radius <= 0) return new Uint8ClampedArray(source);
  const premultiplied = new Float64Array(source.length);
  const weights = new Float64Array(mask.length);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const luminance = (source[offset] + source[offset + 1] + source[offset + 2]) / 765;
    const weight = Math.max(0.04, mask[pixel]) * (1 + Math.max(0, luminance - 0.65) * 2.8 * bokeh);
    weights[pixel] = weight;
    for (let channel = 0; channel < 4; channel += 1) premultiplied[offset + channel] = source[offset + channel] * weight;
  }
  const blurredColor = boxBlurChannels(premultiplied, width, height, radius, 4);
  const blurredWeight = boxBlurChannels(weights, width, height, radius, 1);
  const output = new Uint8ClampedArray(source.length);
  for (let pixel = 0; pixel < weights.length; pixel += 1) {
    const weight = Math.max(1e-5, blurredWeight[pixel]);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) output[offset + channel] = byte(blurredColor[offset + channel] / weight);
  }
  return output;
}

function boxBlurChannels(source, width, height, radius, channels) {
  const horizontal = new Float64Array(source.length);
  const output = new Float64Array(source.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const sums = new Float64Array(channels);
    for (let x = -radius; x <= radius; x += 1) addSample(sums, source, width, y, clamp(x, 0, width - 1), channels, 1);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) horizontal[offset + channel] = sums[channel] / window;
      addSample(sums, source, width, y, clamp(x - radius, 0, width - 1), channels, -1);
      addSample(sums, source, width, y, clamp(x + radius + 1, 0, width - 1), channels, 1);
    }
  }
  for (let x = 0; x < width; x += 1) {
    const sums = new Float64Array(channels);
    for (let y = -radius; y <= radius; y += 1) addSample(sums, horizontal, width, clamp(y, 0, height - 1), x, channels, 1);
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) output[offset + channel] = sums[channel] / window;
      addSample(sums, horizontal, width, clamp(y - radius, 0, height - 1), x, channels, -1);
      addSample(sums, horizontal, width, clamp(y + radius + 1, 0, height - 1), x, channels, 1);
    }
  }
  return output;
}

function addSample(sums, source, width, y, x, channels, direction) { const offset = (y * width + x) * channels; for (let channel = 0; channel < channels; channel += 1) sums[channel] += source[offset + channel] * direction; }
function radiusLevel(radii, radius) { for (let index = 1; index < radii.length; index += 1) if (radius <= radii[index]) return { low: index - 1, high: index, mix: (radius - radii[index - 1]) / Math.max(1e-6, radii[index] - radii[index - 1]) }; return { low: radii.length - 1, high: radii.length - 1, mix: 0 }; }
function interpolateRadius(levels, level, offset, channel) { return levels[level.low][offset + channel] + (levels[level.high][offset + channel] - levels[level.low][offset + channel]) * level.mix; }
function extractRgba(source, width, tile) { const out = new Uint8ClampedArray(tile.width * tile.height * 4); for (let y = 0; y < tile.height; y += 1) out.set(source.subarray(((tile.y + y) * width + tile.x) * 4, ((tile.y + y) * width + tile.x + tile.width) * 4), y * tile.width * 4); return out; }
function extractMono(source, width, tile) { const out = new Uint8Array(tile.width * tile.height); for (let y = 0; y < tile.height; y += 1) out.set(source.subarray((tile.y + y) * width + tile.x, (tile.y + y) * width + tile.x + tile.width), y * tile.width); return out; }
function blendTile(output, weights, width, height, tileData, tile, overlap) { for (let y = 0; y < tile.height; y += 1) for (let x = 0; x < tile.width; x += 1) { const weight = edgeWeight(x, y, tile.width, tile.height, overlap, tile.x === 0, tile.y === 0, tile.x + tile.width === width, tile.y + tile.height === height); const sourceOffset = (y * tile.width + x) * 4; const targetPixel = (tile.y + y) * width + tile.x + x; const targetOffset = targetPixel * 4; for (let channel = 0; channel < 4; channel += 1) output[targetOffset + channel] += tileData[sourceOffset + channel] * weight; weights[targetPixel] += weight; } }
function edgeWeight(x, y, width, height, overlap, leftEdge, topEdge, rightEdge, bottomEdge) { let wx = 1, wy = 1; if (!leftEdge && x < overlap) wx = smooth(x / Math.max(1, overlap)); if (!rightEdge && width - 1 - x < overlap) wx = Math.min(wx, smooth((width - 1 - x) / Math.max(1, overlap))); if (!topEdge && y < overlap) wy = smooth(y / Math.max(1, overlap)); if (!bottomEdge && height - 1 - y < overlap) wy = Math.min(wy, smooth((height - 1 - y) / Math.max(1, overlap))); return Math.max(1e-4, wx * wy); }
function smooth(value) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function normalizeColor(value) { if (Array.isArray(value)) return value.slice(0, 3).map(byte); const hex = String(value).replace('#', ''); const parsed = Number.parseInt(hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex, 16); return Number.isFinite(parsed) ? [parsed >> 16 & 255, parsed >> 8 & 255, parsed & 255] : [210, 225, 238]; }
function toRgba(value, width, height) { const data = value?.data ?? value; if (!data || data.length !== width * height * 4) throw new Error('Efekt głębi wymaga danych RGBA.'); return data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data); }
function clamp01(value) { return clamp(Number(value) || 0, 0, 1); }
function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
