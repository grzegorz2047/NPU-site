import { createAddRestorationLayerCommand } from './editor-restoration-commands.js';
import { RESTORATION_PROFILES, differenceRgba, normalizeRestorationOptions } from './editor-restoration-core.js';
import { RestorationEngine } from './editor-restoration-engine.js';
import { selectionBounds } from './editor-selection.js';
import { getDocumentSelection } from './editor-tools-commands.js';

export class RestorationController {
  constructor({ documentModel, history, renderer, root = document, engine = null } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.root = root;
    this.engine = engine ?? new RestorationEngine();
    this.busy = false;
    this.preview = null;
    ensureRestorationUi(root);
    this.elements = this.resolveElements();
    this.bind();
    this.refresh();
  }

  resolveElements() {
    const get = id => this.root.getElementById(id);
    return {
      panel: get('restoration-panel'), profile: get('restoration-profile'), strength: get('restoration-strength'), strengthOut: get('restoration-strength-output'), sharpen: get('restoration-sharpen'), sharpenOut: get('restoration-sharpen-output'),
      tileSize: get('restoration-tile-size'), overlap: get('restoration-overlap'), localFallback: get('restoration-local-fallback'), previewButton: get('restoration-preview'), processButton: get('restoration-process'), cancelButton: get('restoration-cancel'),
      status: get('restoration-status'), report: get('restoration-report'), previewWrap: get('restoration-preview-wrap'), previewCanvas: get('restoration-preview-canvas'), beforeButton: get('restoration-before'), afterButton: get('restoration-after'), differenceButton: get('restoration-difference')
    };
  }

  bind() {
    const e = this.elements;
    e.profile?.addEventListener('change', () => this.refresh());
    for (const input of [e.strength, e.sharpen]) input?.addEventListener('input', () => this.refreshOutputs());
    e.previewButton?.addEventListener('click', () => this.runPreview());
    e.processButton?.addEventListener('click', () => this.runFull());
    e.cancelButton?.addEventListener('click', () => this.engine.cancel());
    e.beforeButton?.addEventListener('click', () => this.showPreview('before'));
    e.afterButton?.addEventListener('click', () => this.showPreview('after'));
    e.differenceButton?.addEventListener('click', () => this.showPreview('difference'));
    e.beforeButton?.addEventListener('pointerdown', () => this.showPreview('before'));
    e.beforeButton?.addEventListener('pointerup', () => this.showPreview('after'));
    e.beforeButton?.addEventListener('pointercancel', () => this.showPreview('after'));
  }

  options() {
    const e = this.elements;
    return normalizeRestorationOptions({
      profileId: e.profile?.value,
      strength: Number(e.strength?.value ?? 55) / 100,
      sharpen: Number(e.sharpen?.value ?? 20) / 100,
      tileSize: Number(e.tileSize?.value ?? 256),
      overlap: Number(e.overlap?.value ?? 24),
      allowLocalFallback: e.localFallback?.checked !== false
    });
  }

  async runPreview() {
    if (this.busy || !this.documentModel.layers.length) return;
    this.setBusy(true);
    this.setStatus('Przygotowanie podglądu 1:1…');
    try {
      this.renderer.render(this.documentModel);
      const source = cloneCanvas(this.renderer.canvas);
      const selection = getDocumentSelection(this.documentModel);
      const bounds = selection.entries?.length || selection.inverted ? selectionBounds(selection) : null;
      const mode = this.root.getElementById('backend-select')?.value ?? 'auto';
      const result = await this.engine.preview(source, { ...this.options(), mode, region: bounds, previewSize: 256 });
      const before = cropCanvas(source, result.region);
      const beforeScaled = scaleCanvas(before, result.width, result.height);
      this.preview = { before: beforeScaled, after: result.canvas, difference: differenceCanvas(beforeScaled, result.canvas), result };
      if (this.elements.previewWrap) this.elements.previewWrap.hidden = false;
      this.showPreview('after');
      this.renderReport(result);
      this.setStatus(`Podgląd gotowy · ${backendLabel(result.backend)}${result.fallbackReason ? ' · fallback lokalny' : ''}`, result.fallbackReason ? 'warning' : 'success');
    } catch (error) {
      this.setStatus(error?.name === 'AbortError' ? 'Podgląd anulowany.' : error.message || String(error), error?.name === 'AbortError' ? 'warning' : 'danger');
    } finally {
      this.setBusy(false);
    }
  }

  async runFull() {
    if (this.busy || !this.documentModel.layers.length) return;
    this.setBusy(true);
    this.setStatus('Restoration całego obrazu…');
    try {
      this.renderer.render(this.documentModel);
      const source = cloneCanvas(this.renderer.canvas);
      const mode = this.root.getElementById('backend-select')?.value ?? 'auto';
      const result = await this.engine.process(source, { ...this.options(), mode });
      const command = createAddRestorationLayerCommand(this.documentModel, result, { sourceLayerId: this.documentModel.activeLayerId, resizeDocument: true });
      this.history.execute(command, this.documentModel);
      this.renderer.render(this.documentModel);
      this.renderReport(result);
      this.setStatus(`Dodano nową warstwę · ${backendLabel(result.backend)} · ${result.width}×${result.height}`, result.fallbackReason ? 'warning' : 'success');
    } catch (error) {
      this.setStatus(error?.name === 'AbortError' ? 'Przetwarzanie anulowane — dokument nie został zmieniony.' : error.message || String(error), error?.name === 'AbortError' ? 'warning' : 'danger');
    } finally {
      this.setBusy(false);
    }
  }

  showPreview(mode) {
    if (!this.preview || !this.elements.previewCanvas) return;
    const source = this.preview[mode] ?? this.preview.after;
    const canvas = this.elements.previewCanvas;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
    for (const [key, button] of [['before', this.elements.beforeButton], ['after', this.elements.afterButton], ['difference', this.elements.differenceButton]]) if (button) button.dataset.active = String(key === mode);
  }

  renderReport(result) {
    const e = this.elements;
    if (!e.report) return;
    const memory = result.memory?.peakBytes ? formatBytes(result.memory.peakBytes) : '—';
    const time = Number.isFinite(result.durationMs) ? `${Math.round(result.durationMs)} ms` : '—';
    e.report.textContent = `${backendLabel(result.backend)} · ${result.tileCount ?? 1} kaf. · ${time} · szczyt ${memory}`;
    e.report.title = result.fallbackReason ? `Fallback: ${result.fallbackReason}` : JSON.stringify(result.benchmark ?? {});
  }

  setBusy(value) {
    this.busy = Boolean(value);
    const e = this.elements;
    if (e.previewButton) e.previewButton.disabled = this.busy || !this.documentModel.layers.length;
    if (e.processButton) e.processButton.disabled = this.busy || !this.documentModel.layers.length;
    if (e.cancelButton) e.cancelButton.disabled = !this.busy;
    if (e.profile) e.profile.disabled = this.busy;
  }

  refresh() {
    const options = this.options();
    const localOnly = !options.modelId;
    if (this.elements.strength?.closest('label')) this.elements.strength.closest('label').hidden = options.task === 'super-resolution';
    if (this.elements.localFallback?.closest('label')) this.elements.localFallback.closest('label').hidden = localOnly;
    this.refreshOutputs();
    this.setBusy(this.busy);
  }

  refreshOutputs() {
    if (this.elements.strengthOut) this.elements.strengthOut.textContent = `${this.elements.strength?.value ?? 55}%`;
    if (this.elements.sharpenOut) this.elements.sharpenOut.textContent = `${this.elements.sharpen?.value ?? 20}%`;
  }

  setStatus(message, tone = 'neutral') {
    if (!this.elements.status) return;
    this.elements.status.textContent = message;
    this.elements.status.dataset.tone = tone;
  }

  destroy() { this.engine.cancel(); }
}

export function ensureRestorationUi(root = document) {
  if (root.getElementById?.('restoration-panel')) return;
  ensureStylesheet(root);
  const inspector = root.querySelector?.('.inspector');
  if (!inspector) return;
  const panel = root.createElement('details');
  panel.id = 'restoration-panel';
  panel.className = 'inspector-section restoration-section';
  panel.innerHTML = `<summary>Restoration i super-resolution</summary><div class="section-body restoration-body">
    <label>Profil<select id="restoration-profile">${Object.values(RESTORATION_PROFILES).map(profile => `<option value="${profile.id}">${profile.label}</option>`).join('')}</select></label>
    <label><span>Siła <output id="restoration-strength-output">55%</output></span><input id="restoration-strength" type="range" min="0" max="100" value="55" /></label>
    <label><span>Wyostrzenie po wyniku <output id="restoration-sharpen-output">20%</output></span><input id="restoration-sharpen" type="range" min="0" max="100" value="20" /></label>
    <label class="restoration-check"><input id="restoration-local-fallback" type="checkbox" checked /> Użyj lokalnego fallbacku, gdy model nie działa</label>
    <div class="restoration-actions"><button id="restoration-preview" class="panel-button" type="button">Podgląd 1:1</button><button id="restoration-process" class="panel-button" type="button">Nowa warstwa</button><button id="restoration-cancel" class="panel-button" type="button" disabled>Anuluj</button></div>
    <p id="restoration-status" class="restoration-status">Podgląd przetwarza tylko zaznaczenie lub środkowy fragment.</p>
    <p id="restoration-report" class="hint">Brak ostatniego raportu.</p>
    <div id="restoration-preview-wrap" class="restoration-preview-wrap" hidden><canvas id="restoration-preview-canvas" width="256" height="256" aria-label="Podgląd restoration 1:1"></canvas><div class="restoration-compare"><button id="restoration-before" class="panel-button" type="button">Przed</button><button id="restoration-after" class="panel-button" type="button">Po</button><button id="restoration-difference" class="panel-button" type="button">Różnica</button></div></div>
    <details class="restoration-advanced"><summary>Zaawansowane kafelki</summary><div><label>Rozmiar kafelka<select id="restoration-tile-size"><option value="192">192 px</option><option value="256" selected>256 px</option><option value="384">384 px</option><option value="512">512 px</option></select></label><label>Overlap<select id="restoration-overlap"><option value="16">16 px</option><option value="24" selected>24 px</option><option value="32">32 px</option><option value="48">48 px</option></select></label></div></details>
    <p class="hint">Modele Swin2SR używają wspólnego runtime’u WebGPU/WASM. Tryb Tylko NPU zwraca błąd, dopóki kontrakt WebNN nie zostanie fizycznie zweryfikowany.</p>
  </div>`;
  const depth = root.getElementById('depth-panel');
  const smart = root.getElementById('smart-select-panel');
  if (depth) depth.after(panel);
  else if (smart) smart.after(panel);
  else inspector.insertBefore(panel, inspector.querySelector('.layers-section') ?? inspector.firstElementChild?.nextSibling ?? null);
}

function ensureStylesheet(root) { if (root.querySelector?.('link[data-editor-restoration-styles]')) return; const link = root.createElement('link'); link.rel = 'stylesheet'; link.href = './editor-restoration.css'; link.dataset.editorRestorationStyles = 'true'; (root.head ?? root.documentElement)?.append(link); }
function cloneCanvas(source) { const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height; canvas.getContext('2d').drawImage(source, 0, 0); return canvas; }
function cropCanvas(source, rect) { const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height; canvas.getContext('2d').drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height); return canvas; }
function scaleCanvas(source, width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(source, 0, 0, width, height); return canvas; }
function differenceCanvas(before, after) { const width = after.width, height = after.height; const beforeData = before.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height); const afterData = after.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); const image = context.createImageData(width, height); image.data.set(differenceRgba(beforeData.data, afterData.data)); context.putImageData(image, 0, 0); return canvas; }
function backendLabel(backend) { return ({ npu: 'NPU/WebNN', webgpu: 'WebGPU', wasm: 'WASM/CPU', local: 'Lokalny CPU' })[backend] ?? backend ?? 'nieznany backend'; }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`; }
