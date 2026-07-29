import { applyTonalAdjustment, buildCurveLut } from './editor-adjustment-tonal.js';
import { applySpatialAdjustment } from './editor-adjustment-effects.js';

export const ADJUSTMENT_TYPES = Object.freeze([
  'exposure',
  'levels',
  'curves',
  'white-balance',
  'hsl',
  'color',
  'tone',
  'detail',
  'finish'
]);

export const HSL_RANGES = Object.freeze(['master', 'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']);
export const CURVE_CHANNELS = Object.freeze(['rgb', 'red', 'green', 'blue']);

export const ADJUSTMENT_SCHEMAS = Object.freeze({
  exposure: schema('Ekspozycja i kontrast', {
    exposure: field('Ekspozycja', -5, 5, 0, 0.05),
    brightness: field('Jasność', -100, 100, 0, 1),
    contrast: field('Kontrast', -100, 100, 0, 1),
    gamma: field('Gamma', 0.1, 4, 1, 0.05)
  }),
  levels: schema('Poziomy', {}, { channels: defaultLevelsChannels() }),
  curves: schema('Krzywe', {}, { channels: defaultCurveChannels() }),
  'white-balance': schema('Balans bieli', {
    temperature: field('Temperatura', -100, 100, 0, 1),
    tint: field('Tint', -100, 100, 0, 1)
  }),
  hsl: schema('HSL', {}, { ranges: defaultHslRanges() }),
  color: schema('Kolor', {
    vibrance: field('Vibrance', -100, 100, 0, 1),
    saturation: field('Nasycenie', -100, 100, 0, 1)
  }),
  tone: schema('Światła i szczegóły', {
    shadows: field('Cienie', -100, 100, 0, 1),
    highlights: field('Światła', -100, 100, 0, 1),
    clarity: field('Clarity', -100, 100, 0, 1),
    dehaze: field('Dehaze', -100, 100, 0, 1)
  }),
  detail: schema('Ostrość i rozmycie', {
    sharpen: field('Wyostrzenie', 0, 200, 0, 1),
    blur: field('Rozmycie', 0, 20, 0, 0.25)
  }),
  finish: schema('Wykończenie', {
    vignette: field('Winieta', -100, 100, 0, 1),
    grain: field('Ziarno', 0, 100, 0, 1),
    grainSeed: field('Seed ziarna', 0, 9999, 1337, 1)
  })
});

export const BUILTIN_ADJUSTMENT_PRESETS = Object.freeze([
  Object.freeze({ id: 'clean-contrast', name: 'Czysty kontrast', type: 'exposure', parameters: { exposure: 0.15, brightness: 2, contrast: 14, gamma: 1 } }),
  Object.freeze({ id: 'warm-portrait', name: 'Ciepły portret', type: 'white-balance', parameters: { temperature: 18, tint: 4 } }),
  Object.freeze({ id: 'muted-color', name: 'Stonowane kolory', type: 'color', parameters: { vibrance: 14, saturation: -18 } }),
  Object.freeze({ id: 'crisp-detail', name: 'Wyraźny detal', type: 'detail', parameters: { sharpen: 42, blur: 0 } }),
  Object.freeze({ id: 'soft-vignette', name: 'Delikatna winieta', type: 'finish', parameters: { vignette: 28, grain: 4, grainSeed: 1337 } })
]);

export function createAdjustment(type = 'exposure', parameters = {}) {
  if (!ADJUSTMENT_TYPES.includes(type)) throw new Error(`Nieobsługiwany typ korekty: ${type}`);
  return normalizeAdjustment({ type, parameters });
}

export function normalizeAdjustment(value = {}) {
  const type = ADJUSTMENT_TYPES.includes(value.type) ? value.type : 'exposure';
  const schemaValue = ADJUSTMENT_SCHEMAS[type];
  const defaults = adjustmentDefaults(type);
  const parameters = merge(defaults, value.parameters ?? {});
  if (type === 'levels') normalizeLevels(parameters);
  else if (type === 'curves') normalizeCurves(parameters);
  else if (type === 'hsl') normalizeHsl(parameters);
  else normalizeFields(parameters, schemaValue.fields);
  return { version: 1, type, parameters };
}

export function adjustmentDefaults(type) {
  const definition = ADJUSTMENT_SCHEMAS[type];
  if (!definition) throw new Error(`Nieobsługiwany typ korekty: ${type}`);
  const output = clone(definition.defaults ?? {});
  for (const [key, definitionField] of Object.entries(definition.fields ?? {})) output[key] = definitionField.defaultValue;
  return output;
}

export function applyAdjustmentToRgba(source, width, height, adjustment) {
  assertImage(source, width, height);
  const descriptor = normalizeAdjustment(adjustment);
  if (['exposure', 'levels', 'curves', 'white-balance', 'hsl', 'color'].includes(descriptor.type)) {
    return applyTonalAdjustment(descriptor.type, source, descriptor.parameters);
  }
  return applySpatialAdjustment(descriptor.type, source, width, height, descriptor.parameters);
}

export function applyAdjustmentStack(source, width, height, adjustments = []) {
  let output = new Uint8ClampedArray(source);
  for (const adjustment of adjustments) output = applyAdjustmentToRgba(output, width, height, adjustment);
  return output;
}

export function computeHistogram(source, { bins = 256, maxSamples = 250000, shadowThreshold = 4, highlightThreshold = 251 } = {}) {
  if (!source || source.length % 4 !== 0) throw new Error('Histogram wymaga danych RGBA.');
  bins = Math.max(2, Math.trunc(Number(bins)) || 256);
  const channels = {
    red: new Uint32Array(bins),
    green: new Uint32Array(bins),
    blue: new Uint32Array(bins),
    luminance: new Uint32Array(bins)
  };
  const pixels = source.length / 4;
  const step = Math.max(1, Math.ceil(pixels / Math.max(1, maxSamples)));
  let samples = 0;
  let clippedShadows = 0;
  let clippedHighlights = 0;
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const offset = pixel * 4;
    if (source[offset + 3] === 0) continue;
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    channels.red[toBin(red, bins)] += 1;
    channels.green[toBin(green, bins)] += 1;
    channels.blue[toBin(blue, bins)] += 1;
    channels.luminance[toBin(luminance, bins)] += 1;
    if (red <= shadowThreshold && green <= shadowThreshold && blue <= shadowThreshold) clippedShadows += 1;
    if (red >= highlightThreshold && green >= highlightThreshold && blue >= highlightThreshold) clippedHighlights += 1;
    samples += 1;
  }
  return {
    bins,
    samples,
    channels,
    clippedShadows,
    clippedHighlights,
    shadowRatio: samples ? clippedShadows / samples : 0,
    highlightRatio: samples ? clippedHighlights / samples : 0,
    max: Math.max(1, ...channels.red, ...channels.green, ...channels.blue, ...channels.luminance)
  };
}

export { buildCurveLut };

export class AdjustmentPresetStore {
  constructor({ storage = globalThis.localStorage, key = 'localstudio-adjustment-presets-v1' } = {}) {
    this.storage = storage;
    this.key = key;
  }

  list() {
    return [...BUILTIN_ADJUSTMENT_PRESETS.map(clone), ...this.custom()];
  }

  custom() {
    if (!this.storage?.getItem) return [];
    try {
      const value = JSON.parse(this.storage.getItem(this.key) || '[]');
      return Array.isArray(value) ? value.map(normalizePreset).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  save(name, adjustment) {
    const descriptor = normalizeAdjustment(adjustment);
    const preset = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(name || ADJUSTMENT_SCHEMAS[descriptor.type].label).trim(),
      type: descriptor.type,
      parameters: clone(descriptor.parameters),
      custom: true
    };
    const custom = this.custom();
    custom.push(preset);
    this.write(custom);
    return preset;
  }

  remove(id) {
    const custom = this.custom();
    const next = custom.filter(preset => preset.id !== id);
    if (next.length === custom.length) return false;
    this.write(next);
    return true;
  }

  get(id) {
    const preset = this.list().find(item => item.id === id);
    return preset ? clone(preset) : null;
  }

  write(presets) {
    if (!this.storage?.setItem) return;
    this.storage.setItem(this.key, JSON.stringify(presets));
  }
}

function normalizeLevels(parameters) {
  parameters.channels ||= defaultLevelsChannels();
  for (const channel of CURVE_CHANNELS) {
    parameters.channels[channel] = merge(defaultLevel(), parameters.channels[channel] ?? {});
    const value = parameters.channels[channel];
    value.inputBlack = clamp(Math.round(numeric(value.inputBlack, 0)), 0, 254);
    value.inputWhite = clamp(Math.round(numeric(value.inputWhite, 255)), value.inputBlack + 1, 255);
    value.gamma = clamp(numeric(value.gamma, 1), 0.1, 10);
    value.outputBlack = clamp(Math.round(numeric(value.outputBlack, 0)), 0, 255);
    value.outputWhite = clamp(Math.round(numeric(value.outputWhite, 255)), value.outputBlack, 255);
  }
}

function normalizeCurves(parameters) {
  parameters.channels ||= defaultCurveChannels();
  for (const channel of CURVE_CHANNELS) parameters.channels[channel] = normalizeCurvePoints(parameters.channels[channel]);
}

function normalizeHsl(parameters) {
  parameters.ranges ||= defaultHslRanges();
  for (const range of HSL_RANGES) {
    const value = merge(defaultHslRange(), parameters.ranges[range] ?? {});
    value.hue = clamp(numeric(value.hue, 0), -180, 180);
    value.saturation = clamp(numeric(value.saturation, 0), -100, 100);
    value.lightness = clamp(numeric(value.lightness, 0), -100, 100);
    parameters.ranges[range] = value;
  }
}

function normalizeCurvePoints(points) {
  const normalized = (Array.isArray(points) ? points : [])
    .map(point => [clamp(Math.round(Number(point?.[0]) || 0), 0, 255), clamp(Math.round(Number(point?.[1]) || 0), 0, 255)])
    .sort((a, b) => a[0] - b[0]);
  const unique = [];
  for (const point of normalized) {
    const existing = unique.findIndex(item => item[0] === point[0]);
    if (existing >= 0) unique[existing] = point;
    else unique.push(point);
  }
  if (!unique.some(point => point[0] === 0)) unique.unshift([0, 0]);
  if (!unique.some(point => point[0] === 255)) unique.push([255, 255]);
  return unique;
}

function normalizeFields(parameters, fields = {}) {
  for (const [key, definition] of Object.entries(fields)) parameters[key] = clamp(numeric(parameters[key], definition.defaultValue), definition.min, definition.max);
}

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function schema(label, fields, defaults = {}) {
  return Object.freeze({ label, fields: Object.freeze(fields), defaults: Object.freeze(defaults) });
}

function field(label, min, max, defaultValue, step) {
  return Object.freeze({ label, min, max, defaultValue, step });
}

function defaultLevel() {
  return { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 255 };
}

function defaultLevelsChannels() {
  return Object.fromEntries(CURVE_CHANNELS.map(channel => [channel, defaultLevel()]));
}

function defaultCurveChannels() {
  return Object.fromEntries(CURVE_CHANNELS.map(channel => [channel, [[0, 0], [255, 255]]]));
}

function defaultHslRange() {
  return { hue: 0, saturation: 0, lightness: 0 };
}

function defaultHslRanges() {
  return Object.fromEntries(HSL_RANGES.map(range => [range, defaultHslRange()]));
}

function normalizePreset(value) {
  if (!value || !ADJUSTMENT_TYPES.includes(value.type)) return null;
  const descriptor = normalizeAdjustment(value);
  return { id: String(value.id), name: String(value.name || ADJUSTMENT_SCHEMAS[descriptor.type].label), type: descriptor.type, parameters: descriptor.parameters, custom: true };
}

function merge(base, patch) {
  const output = clone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) output[key] = merge(output[key], value);
    else output[key] = clone(value);
  }
  return output;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function assertImage(source, width, height) {
  if (!source || source.length !== width * height * 4) throw new Error('Korekta wymaga danych RGBA zgodnych z wymiarami obrazu.');
}

function toBin(value, bins) {
  return Math.min(bins - 1, Math.floor(value / 256 * bins));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
