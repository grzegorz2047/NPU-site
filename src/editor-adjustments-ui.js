import {
  ADJUSTMENT_SCHEMAS,
  AdjustmentPresetStore,
  CURVE_CHANNELS,
  HSL_RANGES,
  createAdjustment,
  normalizeAdjustment
} from './editor-adjustments.js';
import { isAdjustmentLayer } from './editor-adjustment-renderer.js';
import { createGroupLayer, createLayerMask } from './editor-document.js';
import { addLayerCommand, updateLayerCommand } from './editor-history.js';
import {
  createRangeControl,
  createSelectControl,
  ensureAdjustmentPanel,
} from './editor-adjustments-ui-controls.js';
import {
  applyPreset as applyAdjustmentPreset,
  decorateLayerRows as decorateAdjustmentLayerRows,
  deletePreset as deleteAdjustmentPreset,
  maskFromSelection as createAdjustmentMaskFromSelection,
  refreshPresetButtons as refreshAdjustmentPresetButtons,
  refreshPresets as refreshAdjustmentPresets,
  renderCurves as renderAdjustmentCurves,
  resetMask as resetAdjustmentMask,
  savePreset as saveAdjustmentPreset,
  scheduleHistogram as scheduleAdjustmentHistogram,
  updateClippingOverlay as updateAdjustmentClippingOverlay
} from './editor-adjustments-ui-advanced.js';

const CHANNEL_LABELS = Object.freeze({ rgb: 'RGB', red: 'Czerwony', green: 'Zielony', blue: 'Niebieski' });
const RANGE_LABELS = Object.freeze({ master: 'Wszystkie', red: 'Czerwienie', orange: 'Pomarańcze', yellow: 'Żółcie', green: 'Zielenie', aqua: 'Turkusy', blue: 'Błękity', purple: 'Fiolety', magenta: 'Magenty' });

export class AdjustmentPanel {
  constructor({ documentModel, history, renderer, root = document, presetStore = new AdjustmentPresetStore() } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.root = root;
    this.presetStore = presetStore;
    this.levelChannel = 'rgb';
    this.curveChannel = 'rgb';
    this.hslRange = 'master';
    this.curveDrag = null;
    this.histogramTask = null;
    this.internalUpdate = false;
    ensureAdjustmentPanel(root);
    this.elements = this.resolveElements();
    this.bind();
    this.unsubscribeDocument = documentModel.subscribe(() => { if (!this.internalUpdate) this.refresh(); });
    this.unsubscribeHistory = history.subscribe(() => { if (!this.internalUpdate) this.refresh(); });
    this.refreshPresets();
    this.refresh();
  }

  destroy() {
    this.unsubscribeDocument?.();
    this.unsubscribeHistory?.();
  }

  resolveElements() {
    const get = id => this.root.getElementById(id);
    return {
      type: get('adjustment-type'),
      add: get('adjustment-add'),
      active: get('adjustment-active'),
      controls: get('adjustment-controls'),
      histogram: get('adjustment-histogram'),
      clipping: get('adjustment-clipping'),
      clippingStatus: get('adjustment-clipping-status'),
      before: get('adjustment-before'),
      maskSelection: get('adjustment-mask-selection'),
      maskFull: get('adjustment-mask-full'),
      preset: get('adjustment-preset'),
      presetName: get('adjustment-preset-name'),
      presetApply: get('adjustment-preset-apply'),
      presetSave: get('adjustment-preset-save'),
      presetDelete: get('adjustment-preset-delete')
    };
  }

  bind() {
    const e = this.elements;
    e.add?.addEventListener('click', () => this.addAdjustment(e.type.value));
    e.before?.addEventListener('pointerdown', event => {
      event.preventDefault();
      e.before.setPointerCapture?.(event.pointerId);
      e.before.dataset.active = 'true';
      this.renderer.render(this.documentModel, { includeAdjustments: false });
    });
    const restore = event => {
      if (e.before.dataset.active !== 'true') return;
      if (event?.pointerId !== undefined && e.before.hasPointerCapture?.(event.pointerId)) e.before.releasePointerCapture(event.pointerId);
      e.before.dataset.active = 'false';
      this.renderer.render(this.documentModel);
    };
    e.before?.addEventListener('pointerup', restore);
    e.before?.addEventListener('pointercancel', restore);
    e.before?.addEventListener('lostpointercapture', restore);
    e.clipping?.addEventListener('change', () => this.updateClippingOverlay());
    e.maskSelection?.addEventListener('click', () => this.maskFromSelection());
    e.maskFull?.addEventListener('click', () => this.resetMask());
    e.presetApply?.addEventListener('click', () => this.applyPreset());
    e.presetSave?.addEventListener('click', () => this.savePreset());
    e.presetDelete?.addEventListener('click', () => this.deletePreset());
    e.preset?.addEventListener('change', () => this.refreshPresetButtons());
    this.root.addEventListener('localstudio:render-complete', event => {
      if (event.detail?.includeAdjustments === false) return;
      this.scheduleHistogram();
      this.updateClippingOverlay();
    });
  }

  get activeLayer() {
    const layer = this.documentModel.activeLayer;
    return isAdjustmentLayer(layer) ? layer : null;
  }

  addAdjustment(type) {
    const descriptor = createAdjustment(type);
    const layer = createGroupLayer({
      name: ADJUSTMENT_SCHEMAS[type].label,
      metadata: { kind: 'adjustment', adjustment: descriptor, createdBy: 'adjustment-panel' },
      mask: createLayerMask({ enabled: true, metadata: { mode: 'full' } }),
      children: []
    });
    this.history.execute(addLayerCommand(layer, this.documentModel.layers.length, null), this.documentModel);
    this.renderer.render(this.documentModel);
    this.refresh();
  }

  updateDescriptor(descriptor, path, value, { label = 'Zmień korektę', coalesce = true } = {}) {
    const layer = this.activeLayer;
    if (!layer || layer.locked) return;
    const next = normalizeAdjustment(layer.metadata.adjustment ?? descriptor);
    setPath(next.parameters, path, value);
    const normalized = normalizeAdjustment(next);
    this.internalUpdate = true;
    try {
      this.history.execute(updateLayerCommand(layer.id, {
        metadata: { adjustment: normalized }
      }, {
        label,
        coalesceKey: coalesce ? `adjustment:${layer.id}:${path}` : null
      }), this.documentModel);
      this.renderer.render(this.documentModel);
    } finally {
      this.internalUpdate = false;
    }
  }

  refresh() {
    const layer = this.activeLayer;
    const e = this.elements;
    if (e.active) e.active.textContent = layer ? layer.name : 'Wybierz warstwę korekcyjną albo dodaj nową.';
    for (const element of [e.before, e.maskSelection, e.maskFull]) if (element) element.disabled = !layer;
    this.renderControls(layer ? normalizeAdjustment(layer.metadata.adjustment) : null);
    this.decorateLayerRows();
    this.refreshPresetButtons();
    this.scheduleHistogram();
  }

  renderControls(descriptor) {
    const container = this.elements.controls;
    if (!container) return;
    container.replaceChildren();
    if (!descriptor) {
      const empty = document.createElement('p');
      empty.className = 'adjustment-empty hint';
      empty.textContent = 'Parametry pojawią się po wybraniu warstwy korekcyjnej w panelu warstw.';
      container.append(empty);
      return;
    }
    if (descriptor.type === 'levels') this.renderLevels(container, descriptor);
    else if (descriptor.type === 'curves') this.renderCurves(container, descriptor);
    else if (descriptor.type === 'hsl') this.renderHsl(container, descriptor);
    else this.renderFields(container, descriptor, ADJUSTMENT_SCHEMAS[descriptor.type].fields);
  }

  renderFields(container, descriptor, fields, prefix = '') {
    for (const [key, definition] of Object.entries(fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const value = getPath(descriptor.parameters, path);
      container.append(createRangeControl(definition, value, next => this.updateDescriptor(descriptor, path, next)));
    }
  }

  renderLevels(container, descriptor) {
    container.append(createSelectControl('Kanał', CURVE_CHANNELS, this.levelChannel, CHANNEL_LABELS, value => {
      this.levelChannel = value;
      this.renderControls(descriptor);
    }));
    const fields = {
      inputBlack: { label: 'Czerń wejścia', min: 0, max: 254, step: 1 },
      inputWhite: { label: 'Biel wejścia', min: 1, max: 255, step: 1 },
      gamma: { label: 'Gamma', min: 0.1, max: 4, step: 0.05 },
      outputBlack: { label: 'Czerń wyjścia', min: 0, max: 255, step: 1 },
      outputWhite: { label: 'Biel wyjścia', min: 0, max: 255, step: 1 }
    };
    for (const [key, definition] of Object.entries(fields)) {
      const path = `channels.${this.levelChannel}.${key}`;
      container.append(createRangeControl(definition, getPath(descriptor.parameters, path), value => this.updateDescriptor(descriptor, path, value)));
    }
  }

  renderHsl(container, descriptor) {
    container.append(createSelectControl('Zakres koloru', HSL_RANGES, this.hslRange, RANGE_LABELS, value => {
      this.hslRange = value;
      this.renderControls(descriptor);
    }));
    const fields = {
      hue: { label: 'Odcień', min: -180, max: 180, step: 1 },
      saturation: { label: 'Nasycenie', min: -100, max: 100, step: 1 },
      lightness: { label: 'Jasność', min: -100, max: 100, step: 1 }
    };
    for (const [key, definition] of Object.entries(fields)) {
      const path = `ranges.${this.hslRange}.${key}`;
      container.append(createRangeControl(definition, getPath(descriptor.parameters, path), value => this.updateDescriptor(descriptor, path, value)));
    }
  }

  renderCurves(container, descriptor) { renderAdjustmentCurves(this, container, descriptor); }

  maskFromSelection() { createAdjustmentMaskFromSelection(this); }

  resetMask() { resetAdjustmentMask(this); }

  refreshPresets() { refreshAdjustmentPresets(this); }

  refreshPresetButtons() { refreshAdjustmentPresetButtons(this); }

  applyPreset() { applyAdjustmentPreset(this); }

  savePreset() { saveAdjustmentPreset(this); }

  deletePreset() { deleteAdjustmentPreset(this); }

  decorateLayerRows() { decorateAdjustmentLayerRows(this); }

  scheduleHistogram() { scheduleAdjustmentHistogram(this); }

  updateClippingOverlay() { updateAdjustmentClippingOverlay(this); }
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let current = object;
  for (let index = 0; index < parts.length - 1; index += 1) current = current[parts[index]];
  current[parts.at(-1)] = value;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}
