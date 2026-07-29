export function applySpatialAdjustment(type, data, width, height, parameters) {
  if (type === 'tone') return applyTone(data, width, height, parameters);
  if (type === 'detail') return applyDetail(data, width, height, parameters);
  if (type === 'finish') return applyFinish(data, width, height, parameters);
  return new Uint8ClampedArray(data);
}

function applyTone(data, width, height, parameters) {
  let output = mapRgbChannels(data, (red, green, blue) => {
    const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    const shift = parameters.shadows / 100 * ((1 - luminance) ** 2) * 72 + parameters.highlights / 100 * (luminance ** 2) * 72;
    const contrast = 1 + parameters.dehaze / 100 * 0.55;
    return [(red + shift - 128) * contrast + 128, (green + shift - 128) * contrast + 128, (blue + shift - 128) * contrast + 128];
  });
  if (!parameters.clarity) return output;
  const blurred = boxBlur(output, width, height, 2);
  const amount = parameters.clarity / 100 * 0.9;
  const source = output;
  output = new Uint8ClampedArray(source);
  for (let i = 0; i < output.length; i += 4) {
    const luminance = (source[i] + source[i + 1] + source[i + 2]) / (3 * 255);
    const midtone = 1 - Math.min(1, Math.abs(luminance - 0.5) * 2);
    for (let channel = 0; channel < 3; channel += 1) output[i + channel] = byte(source[i + channel] + (source[i + channel] - blurred[i + channel]) * amount * midtone);
  }
  return output;
}

function applyDetail(data, width, height, parameters) {
  let output = new Uint8ClampedArray(data);
  if (parameters.blur > 0) output = boxBlur(output, width, height, Math.max(1, Math.round(parameters.blur)));
  if (!parameters.sharpen) return output;
  const blurred = boxBlur(output, width, height, 1);
  const amount = parameters.sharpen / 100;
  const source = output;
  output = new Uint8ClampedArray(source);
  for (let i = 0; i < output.length; i += 4) for (let channel = 0; channel < 3; channel += 1) output[i + channel] = byte(source[i + channel] + (source[i + channel] - blurred[i + channel]) * amount);
  return output;
}

function applyFinish(data, width, height, parameters) {
  const output = new Uint8ClampedArray(data);
  const vignette = parameters.vignette / 100;
  const grain = parameters.grain / 100 * 34;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxDistance = Math.max(1, Math.hypot(centerX, centerY));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
    const weight = Math.max(0, (distance - 0.32) / 0.68) ** 1.7;
    const vignetteShift = -vignette * weight * 110;
    const noise = grain ? (hashNoise(x, y, parameters.grainSeed) - 0.5) * grain * 2 : 0;
    for (let channel = 0; channel < 3; channel += 1) output[offset + channel] = byte(output[offset + channel] + vignetteShift + noise);
  }
  return output;
}

function boxBlur(source, width, height, radius) {
  radius = Math.max(1, Math.min(40, Math.round(radius)));
  const horizontal = new Float64Array(source.length);
  const output = new Uint8ClampedArray(source.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const sums = [0, 0, 0, 0];
    for (let x = -radius; x <= radius; x += 1) addPixel(sums, source, width, y, clamp(x, 0, width - 1), 1);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) horizontal[offset + channel] = sums[channel] / window;
      addPixel(sums, source, width, y, clamp(x - radius, 0, width - 1), -1);
      addPixel(sums, source, width, y, clamp(x + radius + 1, 0, width - 1), 1);
    }
  }
  for (let x = 0; x < width; x += 1) {
    const sums = [0, 0, 0, 0];
    for (let y = -radius; y <= radius; y += 1) addPixel(sums, horizontal, width, clamp(y, 0, height - 1), x, 1);
    for (let y = 0; y < height; y += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[offset + channel] = byte(sums[channel] / window);
      addPixel(sums, horizontal, width, clamp(y - radius, 0, height - 1), x, -1);
      addPixel(sums, horizontal, width, clamp(y + radius + 1, 0, height - 1), x, 1);
    }
  }
  return output;
}

function addPixel(sums, source, width, y, x, direction) {
  const offset = (y * width + x) * 4;
  for (let channel = 0; channel < 4; channel += 1) sums[channel] += source[offset + channel] * direction;
}
function mapRgbChannels(data, mapper) {
  const output = new Uint8ClampedArray(data);
  for (let i = 0; i < output.length; i += 4) {
    const values = mapper(output[i], output[i + 1], output[i + 2]);
    output[i] = byte(values[0]); output[i + 1] = byte(values[1]); output[i + 2] = byte(values[2]);
  }
  return output;
}
function hashNoise(x, y, seed) {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(Math.round(seed) + 1, 2147483647);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
