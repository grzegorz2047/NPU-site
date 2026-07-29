const CHANNELS = ['rgb', 'red', 'green', 'blue'];
const HSL_RANGES = ['master', 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

export function applyTonalAdjustment(type, data, parameters) {
  if (type === 'exposure') return applyExposure(data, parameters);
  if (type === 'levels') return applyLevels(data, parameters);
  if (type === 'curves') return applyCurves(data, parameters);
  if (type === 'white-balance') return applyWhiteBalance(data, parameters);
  if (type === 'hsl') return applyHsl(data, parameters);
  if (type === 'color') return applyColor(data, parameters);
  return new Uint8ClampedArray(data);
}

export function buildCurveLut(points = [[0, 0], [255, 255]]) {
  const normalized = normalizeCurvePoints(points);
  const lut = new Uint8ClampedArray(256);
  let segment = 0;
  for (let x = 0; x < 256; x += 1) {
    while (segment < normalized.length - 2 && x > normalized[segment + 1][0]) segment += 1;
    const left = normalized[segment];
    const right = normalized[Math.min(segment + 1, normalized.length - 1)];
    const t = clamp((x - left[0]) / Math.max(1, right[0] - left[0]), 0, 1);
    lut[x] = byte(left[1] + (right[1] - left[1]) * t);
  }
  return lut;
}

function applyExposure(data, parameters) {
  const exposure = 2 ** parameters.exposure;
  const brightness = parameters.brightness * 2.55;
  const c = parameters.contrast / 100;
  const contrast = c >= 0 ? 1 + c * 3 : 1 + c * 0.75;
  const inverseGamma = 1 / parameters.gamma;
  return mapRgb(data, value => {
    const exposed = value * exposure + brightness;
    const contrasted = contrast * (exposed - 128) + 128;
    return 255 * ((clamp(contrasted, 0, 255) / 255) ** inverseGamma);
  });
}

function applyLevels(data, parameters) {
  const luts = Object.fromEntries(CHANNELS.map(channel => [channel, buildLevelsLut(parameters.channels[channel])]));
  return mapChannelsWithLuts(data, luts);
}

function applyCurves(data, parameters) {
  const luts = Object.fromEntries(CHANNELS.map(channel => [channel, buildCurveLut(parameters.channels[channel])]));
  return mapChannelsWithLuts(data, luts);
}

function mapChannelsWithLuts(data, luts) {
  const output = new Uint8ClampedArray(data);
  for (let i = 0; i < output.length; i += 4) {
    output[i] = luts.red[luts.rgb[output[i]]];
    output[i + 1] = luts.green[luts.rgb[output[i + 1]]];
    output[i + 2] = luts.blue[luts.rgb[output[i + 2]]];
  }
  return output;
}

function applyWhiteBalance(data, parameters) {
  const temperature = parameters.temperature / 100;
  const tint = parameters.tint / 100;
  return mapRgbChannels(data, (red, green, blue) => [
    red + temperature * 34 + tint * 5,
    green - tint * 26,
    blue - temperature * 34 + tint * 5
  ]);
}

function applyHsl(data, parameters) {
  return mapRgbChannels(data, (red, green, blue) => {
    let [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    for (const range of HSL_RANGES) {
      const adjustment = parameters.ranges[range];
      const weight = range === 'master' ? 1 : hueRangeWeight(hue, range);
      hue = wrapHue(hue + adjustment.hue / 360 * weight);
      saturation = clamp(saturation + adjustment.saturation / 100 * weight, 0, 1);
      lightness = clamp(lightness + adjustment.lightness / 100 * weight, 0, 1);
    }
    return hslToRgb(hue, saturation, lightness);
  });
}

function applyColor(data, parameters) {
  const saturationDelta = parameters.saturation / 100;
  const vibranceDelta = parameters.vibrance / 100;
  return mapRgbChannels(data, (red, green, blue) => {
    const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    const next = clamp(saturation + saturationDelta + vibranceDelta * (1 - saturation) * 0.75, 0, 1);
    return hslToRgb(hue, next, lightness);
  });
}

function buildLevelsLut(levels) {
  const inputWhite = Math.max(levels.inputBlack + 1, levels.inputWhite);
  const outputWhite = Math.max(levels.outputBlack, levels.outputWhite);
  const inverseGamma = 1 / levels.gamma;
  const lut = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    const normalized = clamp((value - levels.inputBlack) / (inputWhite - levels.inputBlack), 0, 1) ** inverseGamma;
    lut[value] = byte(levels.outputBlack + normalized * (outputWhite - levels.outputBlack));
  }
  return lut;
}

function normalizeCurvePoints(points) {
  const normalized = (Array.isArray(points) ? points : [])
    .map(point => [clamp(Math.round(Number(point?.[0]) || 0), 0, 255), clamp(Math.round(Number(point?.[1]) || 0), 0, 255)])
    .sort((a, b) => a[0] - b[0]);
  const unique = [];
  for (const point of normalized) {
    const index = unique.findIndex(item => item[0] === point[0]);
    if (index >= 0) unique[index] = point;
    else unique.push(point);
  }
  if (!unique.some(point => point[0] === 0)) unique.unshift([0, 0]);
  if (!unique.some(point => point[0] === 255)) unique.push([255, 255]);
  return unique;
}

function mapRgb(data, mapper) {
  const output = new Uint8ClampedArray(data);
  for (let i = 0; i < output.length; i += 4) {
    output[i] = byte(mapper(output[i]));
    output[i + 1] = byte(mapper(output[i + 1]));
    output[i + 2] = byte(mapper(output[i + 2]));
  }
  return output;
}

function mapRgbChannels(data, mapper) {
  const output = new Uint8ClampedArray(data);
  for (let i = 0; i < output.length; i += 4) {
    const values = mapper(output[i], output[i + 1], output[i + 2]);
    output[i] = byte(values[0]);
    output[i + 1] = byte(values[1]);
    output[i + 2] = byte(values[2]);
  }
  return output;
}

function rgbToHsl(red, green, blue) {
  red /= 255; green /= 255; blue /= 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (delta) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = wrapHue(hue / 6);
  }
  return [hue, saturation, lightness];
}

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const position = wrapHue(hue) * 6;
  const x = chroma * (1 - Math.abs((position % 2) - 1));
  let rgb = position < 1 ? [chroma, x, 0] : position < 2 ? [x, chroma, 0] : position < 3 ? [0, chroma, x] : position < 4 ? [0, x, chroma] : position < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = lightness - chroma / 2;
  return rgb.map(value => (value + match) * 255);
}

function hueRangeWeight(hue, range) {
  const centers = { red: 0, orange: 30 / 360, yellow: 60 / 360, green: 120 / 360, aqua: 180 / 360, blue: 240 / 360, purple: 280 / 360, magenta: 320 / 360 };
  const center = centers[range];
  if (center === undefined) return 0;
  const distance = Math.min(Math.abs(hue - center), 1 - Math.abs(hue - center));
  return smoothstep(70 / 360, 18 / 360, distance);
}

function wrapHue(value) { return ((value % 1) + 1) % 1; }
function byte(value) { return Math.round(clamp(Number(value) || 0, 0, 255)); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
