import { ADJUSTMENT_SCHEMAS, computeHistogram, createAdjustment } from './editor-adjustments.js';
import { isAdjustmentLayer } from './editor-adjustment-renderer.js';
import { createId, createLayerMask } from './editor-document.js';
import { updateLayerCommand } from './editor-history.js';
import { rasterizeSelection } from './editor-selection.js';
import {
  createSelectControl,
  curvePointFromEvent,
  drawCurveEditor,
  drawHistogram,
  ensureClippingOverlay,
  nearestCurvePoint
} from './editor-adjustments-ui-controls.js';

const CHANNELS = ['rgb', 'red', 'green', 'blue'];
const CHANNEL_LABELS = { rgb: 'RGB', red: 'Czerwony', green: 'Zielony', blue: 'Niebieski' };

export function renderCurves(panel, container, descriptor) {
  container.append(createSelectControl('Kanał krzywej', CHANNELS, panel.curveChannel, CHANNEL_LABELS, value => {
    panel.curveChannel = value;
    panel.renderControls(descriptor);
  }));
  const wrap = document.createElement('div');
  wrap.className = 'curve-editor-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'curve-editor';
  canvas.width = 256;
  canvas.height = 150;
  canvas.setAttribute('aria-label', `Krzywa kanału ${CHANNEL_LABELS[panel.curveChannel]}`);
  canvas.tabIndex = 0;
  const points = descriptor.parameters.channels[panel.curveChannel];
  drawCurveEditor(canvas, points, panel.curveChannel);
  canvas.addEventListener('pointerdown', event => startCurveDrag(panel, event, canvas, descriptor));
  canvas.addEventListener('pointermove', event => moveCurvePoint(panel, event, canvas, descriptor));
  canvas.addEventListener('pointerup', event => finishCurveDrag(panel, event));
  canvas.addEventListener('pointercancel', event => finishCurveDrag(panel, event));
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    const location = curvePointFromEvent(event, canvas);
    const next = clone(points);
    const index = nearestCurvePoint(next, location.x, location.y, 18);
    if (index > 0 && index < next.length - 1) {
      next.splice(index, 1);
      panel.updateDescriptor(descriptor, `channels.${panel.curveChannel}`, next, { label: 'Usuń punkt krzywej', coalesce: false });
    }
  });
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Kliknij, aby dodać punkt. Przeciągnij punkt. Prawy przycisk usuwa punkt pośredni.';
  wrap.append(canvas, hint);
  container.append(wrap);
}

function startCurveDrag(panel, event, canvas, descriptor) {
  const location = curvePointFromEvent(event, canvas);
  const points = clone(descriptor.parameters.channels[panel.curveChannel]);
  let index = nearestCurvePoint(points, location.x, location.y, 16);
  if (index < 0) {
    points.push([location.x, location.y]);
    points.sort((a, b) => a[0] - b[0]);
    index = points.findIndex(point => point[0] === location.x && point[1] === location.y);
  }
  panel.curveDrag = { pointerId: event.pointerId, index, points };
  canvas.setPointerCapture?.(event.pointerId);
  panel.updateDescriptor(descriptor, `channels.${panel.curveChannel}`, points, { label: 'Zmień krzywą', coalesce: true });
}

function moveCurvePoint(panel, event, canvas, descriptor) {
  if (!panel.curveDrag || panel.curveDrag.pointerId !== event.pointerId) return;
  const location = curvePointFromEvent(event, canvas);
  const points = clone(panel.curveDrag.points);
  const index = panel.curveDrag.index;
  const minX = index === 0 ? 0 : points[index - 1][0] + 1;
  const maxX = index === points.length - 1 ? 255 : points[index + 1][0] - 1;
  points[index] = [index === 0 ? 0 : index === points.length - 1 ? 255 : clamp(location.x, minX, maxX), location.y];
  panel.curveDrag.points = points;
  panel.updateDescriptor(descriptor, `channels.${panel.curveChannel}`, points, { label: 'Zmień krzywą', coalesce: true });
}

function finishCurveDrag(panel, event) {
  if (!panel.curveDrag || panel.curveDrag.pointerId !== event.pointerId) return;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  panel.curveDrag = null;
}

export function maskFromSelection(panel) {
  const layer = panel.activeLayer;
  const selection = panel.documentModel.metadata?.selection;
  if (!layer || !selection?.entries?.length) return;
  const values = rasterizeSelection(selection, panel.documentModel.width, panel.documentModel.height);
  const canvas = document.createElement('canvas');
  canvas.width = panel.documentModel.width;
  canvas.height = panel.documentModel.height;
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(canvas.width, canvas.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = values[pixel];
  }
  context.putImageData(imageData, 0, 0);
  const assetId = createId('adjustment-mask');
  panel.documentModel.setRuntimeAsset(assetId, canvas);
  panel.history.execute(updateLayerCommand(layer.id, {
    mask: createLayerMask({ enabled: true, assetId, metadata: { source: 'selection', createdAt: new Date().toISOString() } })
  }, { label: 'Utwórz maskę korekty z zaznaczenia' }), panel.documentModel);
  panel.renderer.render(panel.documentModel);
}

export function resetMask(panel) {
  const layer = panel.activeLayer;
  if (!layer) return;
  panel.history.execute(updateLayerCommand(layer.id, {
    mask: createLayerMask({ enabled: true, metadata: { mode: 'full' } })
  }, { label: 'Ustaw pełną maskę korekty' }), panel.documentModel);
  panel.renderer.render(panel.documentModel);
}

export function refreshPresets(panel) {
  const select = panel.elements.preset;
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Wybierz preset…';
  select.append(placeholder);
  for (const preset of panel.presetStore.list()) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.custom ? '★ ' : ''}${preset.name}`;
    option.dataset.custom = String(Boolean(preset.custom));
    select.append(option);
  }
  if ([...select.options].some(option => option.value === current)) select.value = current;
  refreshPresetButtons(panel);
}

export function refreshPresetButtons(panel) {
  const preset = panel.presetStore.get(panel.elements.preset?.value);
  if (panel.elements.presetApply) panel.elements.presetApply.disabled = !preset;
  if (panel.elements.presetDelete) panel.elements.presetDelete.disabled = !preset?.custom;
  if (panel.elements.presetSave) panel.elements.presetSave.disabled = !panel.activeLayer;
}

export function applyPreset(panel) {
  const preset = panel.presetStore.get(panel.elements.preset?.value);
  if (!preset) return;
  const descriptor = createAdjustment(preset.type, preset.parameters);
  if (!panel.activeLayer) panel.addAdjustment(preset.type);
  const layer = panel.activeLayer;
  if (!layer) return;
  panel.history.execute(updateLayerCommand(layer.id, {
    name: preset.name,
    metadata: { adjustment: descriptor }
  }, { label: `Zastosuj preset: ${preset.name}` }), panel.documentModel);
  panel.renderer.render(panel.documentModel);
  panel.refresh();
}

export function savePreset(panel) {
  const layer = panel.activeLayer;
  if (!layer) return;
  const name = panel.elements.presetName?.value.trim() || layer.name;
  const preset = panel.presetStore.save(name, layer.metadata.adjustment);
  if (panel.elements.presetName) panel.elements.presetName.value = '';
  refreshPresets(panel);
  panel.elements.preset.value = preset.id;
  refreshPresetButtons(panel);
}

export function deletePreset(panel) {
  const id = panel.elements.preset?.value;
  if (id && panel.presetStore.remove(id)) refreshPresets(panel);
}

export function decorateLayerRows(panel) {
  const rows = panel.root.querySelectorAll?.('.layer-row') ?? [];
  for (const row of rows) {
    const layer = panel.documentModel.getLayer(row.dataset.layerId);
    const adjustment = isAdjustmentLayer(layer);
    row.dataset.adjustment = String(adjustment);
    if (!adjustment) continue;
    const thumbnail = row.querySelector('.layer-thumbnail');
    if (thumbnail) {
      thumbnail.textContent = '◐';
      thumbnail.classList.add('layer-thumbnail-adjustment');
      thumbnail.title = `Korekta: ${ADJUSTMENT_SCHEMAS[layer.metadata.adjustment.type]?.label ?? layer.metadata.adjustment.type}`;
    }
  }
}

export function scheduleHistogram(panel) {
  if (!panel.elements.histogram || panel.histogramTask) return;
  const run = () => {
    panel.histogramTask = null;
    try {
      const canvas = panel.renderer.canvas;
      const imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      const histogram = computeHistogram(imageData.data);
      drawHistogram(panel.elements.histogram, histogram);
      if (panel.elements.clippingStatus) panel.elements.clippingStatus.textContent = `Cienie ${(histogram.shadowRatio * 100).toFixed(1)}% · światła ${(histogram.highlightRatio * 100).toFixed(1)}%`;
    } catch (error) {
      if (panel.elements.clippingStatus) panel.elements.clippingStatus.textContent = `Histogram niedostępny: ${error.message}`;
    }
  };
  if (typeof requestIdleCallback === 'function') panel.histogramTask = requestIdleCallback(run, { timeout: 250 });
  else panel.histogramTask = setTimeout(run, 0);
}

export function updateClippingOverlay(panel) {
  const overlay = ensureClippingOverlay(panel.root, panel.renderer.canvas);
  if (!overlay) return;
  overlay.width = panel.renderer.canvas.width;
  overlay.height = panel.renderer.canvas.height;
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (!panel.elements.clipping?.checked) return;
  try {
    const source = panel.renderer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, overlay.width, overlay.height).data;
    const imageData = context.createImageData(overlay.width, overlay.height);
    for (let pixel = 0; pixel < source.length / 4; pixel += 1) {
      const offset = pixel * 4;
      const dark = source[offset] <= 4 && source[offset + 1] <= 4 && source[offset + 2] <= 4;
      const bright = source[offset] >= 251 && source[offset + 1] >= 251 && source[offset + 2] >= 251;
      if (dark) imageData.data.set([48, 120, 255, 150], offset);
      else if (bright) imageData.data.set([255, 64, 72, 150], offset);
    }
    context.putImageData(imageData, 0, 0);
  } catch {
    context.clearRect(0, 0, overlay.width, overlay.height);
  }
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
