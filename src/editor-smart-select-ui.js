import { SmartSelectEngine, serializeSmartAnalysis } from './editor-smart-select-engine.js';
import { combineSelectedObjects, hitTestSmartObjects } from './editor-smart-objects.js';
import { paintMask, refineMask } from './editor-smart-mask.js';
import {
  applySmartMaskToLayer,
  convertDocumentMaskToLayerSpace,
  installSmartMaskRendering
} from './editor-smart-mask-renderer.js';

const CATEGORY_ICONS = Object.freeze({ person: '◉', product: '◆', car: '▰', sky: '☁', vegetation: '♣', other: '▧' });

export class SmartSelectController {
  constructor({ documentModel, history, renderer, canvasController, toolsController, root = document, engine = null } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.canvasController = canvasController;
    this.toolsController = toolsController;
    this.root = root;
    this.engine = engine ?? new SmartSelectEngine();
    this.active = false;
    this.analysis = null;
    this.selectedIds = new Set();
    this.currentMask = null;
    this.mode = 'select';
    this.brushStroke = null;
    this.processing = false;
    this.progress = 0;
    this.sourceCanvas = null;
    this.hoverPoint = null;
    this.settings = { feather: 3, expand: 0, contract: 0, threshold: 0.5, softness: 0.12, brushSize: 40, brushHardness: 0.65, brushOpacity: 1 };
    installSmartMaskRendering(renderer);
    ensureSmartSelectUi(root);
    this.elements = this.resolveElements();
    this.overlay = root.getElementById('overlay-canvas');
    this.context = this.overlay?.getContext('2d');
    this.bind();
    this.unsubscribe = documentModel.subscribe(() => this.refreshTarget());
    this.refresh();
  }

  destroy() {
    this.unsubscribe?.();
    this.engine.cancel();
  }

  resolveElements() {
    const get = id => this.root.getElementById(id);
    return {
      panel: get('smart-select-panel'),
      activate: get('smart-select-tool'),
      analyze: get('smart-select-analyze'),
      cancel: get('smart-select-cancel'),
      status: get('smart-select-status'),
      progress: get('smart-select-progress'),
      progressBar: get('smart-select-progress-bar'),
      backend: get('smart-select-backend'),
      list: get('smart-select-object-list'),
      selectAll: get('smart-select-all'),
      clear: get('smart-select-clear'),
      apply: get('smart-select-apply'),
      modeButtons: [...this.root.querySelectorAll('[data-smart-mode]')],
      feather: get('smart-select-feather'), featherOut: get('smart-select-feather-output'),
      expand: get('smart-select-expand'), expandOut: get('smart-select-expand-output'),
      contract: get('smart-select-contract'), contractOut: get('smart-select-contract-output'),
      threshold: get('smart-select-threshold'), thresholdOut: get('smart-select-threshold-output'),
      softness: get('smart-select-softness'), softnessOut: get('smart-select-softness-output'),
      brushSize: get('smart-select-brush-size'), brushSizeOut: get('smart-select-brush-size-output'),
      brushHardness: get('smart-select-brush-hardness'), brushHardnessOut: get('smart-select-brush-hardness-output')
    };
  }

  bind() {
    const e = this.elements;
    e.activate?.addEventListener('click', () => this.setActive(!this.active));
    e.analyze?.addEventListener('click', () => this.analyze());
    e.cancel?.addEventListener('click', () => this.cancel());
    e.selectAll?.addEventListener('click', () => { this.selectedIds = new Set(this.analysis?.objects.map(object => object.id) ?? []); this.rebuildMask(); this.refresh(); });
    e.clear?.addEventListener('click', () => { this.selectedIds.clear(); this.currentMask = new Uint8Array(this.documentModel.width * this.documentModel.height); this.refresh(); this.drawOverlay(); });
    e.apply?.addEventListener('click', () => this.applyMask());
    for (const button of e.modeButtons) button.addEventListener('click', () => this.setMode(button.dataset.smartMode));
    for (const key of ['feather', 'expand', 'contract', 'threshold', 'softness', 'brushSize', 'brushHardness']) {
      e[key]?.addEventListener('input', () => {
        const value = Number(e[key].value);
        this.settings[key] = ['threshold', 'softness', 'brushHardness'].includes(key) ? value / 100 : value;
        this.refreshOutputs();
        if (['feather', 'expand', 'contract', 'threshold', 'softness'].includes(key)) this.rebuildMask();
        this.drawOverlay();
      });
    }
    this.overlay?.addEventListener('pointerdown', event => this.pointerDown(event));
    this.overlay?.addEventListener('pointermove', event => this.pointerMove(event));
    this.overlay?.addEventListener('pointerup', event => this.pointerUp(event));
    this.overlay?.addEventListener('pointercancel', event => this.pointerCancel(event));
    this.root.addEventListener('keydown', event => {
      if (isEditable(event.target) || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === 'q') { event.preventDefault(); this.setActive(true); }
      else if (event.key === 'Escape' && this.active) { if (this.processing) this.cancel(); else this.setActive(false); }
    });
  }

  setActive(active) {
    this.active = Boolean(active);
    if (this.active) {
      this.toolsController?.setTool?.('none');
      globalThis.localStudioRetouch?.controller?.deactivate?.();
      if (this.elements.panel) this.elements.panel.open = true;
    } else {
      this.brushStroke = null;
      this.clearOverlay();
    }
    this.refresh();
  }

  setMode(mode) {
    if (!['select', 'add', 'subtract'].includes(mode)) return;
    this.mode = mode;
    this.refresh();
    this.drawOverlay();
  }

  async analyze() {
    if (this.processing || !this.documentModel.layers.length) return;
    this.processing = true; this.progress = 0; this.analysis = null; this.selectedIds.clear(); this.refresh();
    try {
      this.renderer.render(this.documentModel);
      this.sourceCanvas = cloneCanvas(this.renderer.canvas, this.documentModel.width, this.documentModel.height);
      const backendMode = this.root.getElementById('backend-select')?.value ?? 'auto';
      this.setStatus('Analiza semantyczna i detekcja obiektów…', 'neutral');
      this.analysis = await this.engine.analyze(this.sourceCanvas, {
        mode: backendMode,
        width: this.documentModel.width,
        height: this.documentModel.height,
        includePersonMatting: true,
        onProgress: event => { this.progress = Number(event.progress) || 0; this.setStatus(event.label || stageLabel(event.stage), 'neutral'); this.refreshProgress(); }
      });
      const preferred = this.analysis.objects.find(object => object.category === 'person') ?? this.analysis.objects[0];
      if (preferred) this.selectedIds.add(preferred.id);
      this.rebuildMask();
      this.setStatus(this.analysis.objects.length ? `Znaleziono ${this.analysis.objects.length} obiektów. Kliknij obiekt lub zaznacz go na liście.` : 'Nie znaleziono obiektów.', this.analysis.objects.length ? 'success' : 'warning');
      this.renderObjectList();
      this.drawOverlay();
    } catch (error) {
      this.setStatus(error?.name === 'AbortError' ? 'Analiza anulowana.' : error.message || String(error), error?.name === 'AbortError' ? 'warning' : 'danger');
    } finally { this.processing = false; this.refresh(); }
  }

  cancel() { return this.processing ? this.engine.cancel('Smart Select anulowany przez użytkownika.') : false; }

  rebuildMask() {
    if (!this.analysis) return;
    const base = combineSelectedObjects(this.analysis.objects, this.selectedIds, this.analysis.width, this.analysis.height, 'union');
    let sourceRgba = null;
    try { sourceRgba = this.sourceCanvas?.getContext?.('2d', { willReadFrequently: true })?.getImageData?.(0, 0, this.analysis.width, this.analysis.height)?.data; } catch {}
    this.currentMask = refineMask(base, this.analysis.width, this.analysis.height, {
      feather: this.settings.feather, expand: this.settings.expand, contract: this.settings.contract,
      threshold: this.settings.threshold, softness: this.settings.softness, sourceRgba
    });
    this.drawOverlay();
  }

  pointerDown(event) {
    if (!this.active || !this.analysis || event.button !== 0) return;
    const point = this.point(event);
    if (this.mode === 'select') {
      const hit = hitTestSmartObjects(this.analysis.objects, point.x, point.y)[0];
      if (!hit) return;
      if (event.shiftKey) { if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id); else this.selectedIds.add(hit.id); }
      else this.selectedIds = new Set([hit.id]);
      this.rebuildMask(); this.refresh(); return;
    }
    this.brushStroke = { pointerId: event.pointerId, points: [point] };
    this.overlay.setPointerCapture?.(event.pointerId); this.drawOverlay();
  }

  pointerMove(event) {
    if (!this.active || !this.analysis) return;
    const point = this.point(event); this.hoverPoint = point;
    if (this.brushStroke?.pointerId === event.pointerId) this.brushStroke.points.push(point);
    this.drawOverlay();
  }

  pointerUp(event) {
    if (!this.brushStroke || this.brushStroke.pointerId !== event.pointerId) return;
    this.overlay.releasePointerCapture?.(event.pointerId);
    const points = this.brushStroke.points; this.brushStroke = null;
    this.currentMask = paintMask(this.currentMask, this.analysis.width, this.analysis.height, points, {
      mode: this.mode, size: this.settings.brushSize, hardness: this.settings.brushHardness, opacity: this.settings.brushOpacity, spacing: 0.14
    });
    this.drawOverlay();
  }

  pointerCancel(event) {
    if (!this.brushStroke || this.brushStroke.pointerId !== event.pointerId) return;
    this.overlay.releasePointerCapture?.(event.pointerId); this.brushStroke = null; this.drawOverlay();
  }

  applyMask() {
    if (!this.currentMask) return;
    const layer = this.documentModel.activeLayer;
    if (!layer || layer.type === 'group' || layer.locked) { this.setStatus('Wybierz niezablokowaną warstwę obrazu lub malowania.', 'warning'); return; }
    const localMask = convertDocumentMaskToLayerSpace(this.currentMask, this.documentModel.width, this.documentModel.height, layer.transform);
    applySmartMaskToLayer({
      documentModel: this.documentModel, history: this.history, renderer: this.renderer, layerId: layer.id, mask: localMask,
      metadata: { analysis: serializeSmartAnalysis(this.analysis), selectedObjectIds: [...this.selectedIds], backendSummary: this.analysis.backendSummary, refinement: { ...this.settings } }
    });
    this.setStatus(`Maska Smart Select została dodana do warstwy „${layer.name}”.`, 'success');
  }

  point(event) {
    const point = this.canvasController.viewport.clientToDocument(event.clientX, event.clientY);
    return { x: clamp(point.x, 0, this.documentModel.width - 1), y: clamp(point.y, 0, this.documentModel.height - 1), pressure: event.pressure > 0 ? event.pressure : 1 };
  }

  renderObjectList() {
    const list = this.elements.list; if (!list) return; list.replaceChildren();
    if (!this.analysis?.objects.length) { const empty = document.createElement('p'); empty.className = 'smart-empty'; empty.textContent = 'Uruchom analizę, aby zobaczyć obiekty.'; list.append(empty); return; }
    for (const object of this.analysis.objects) {
      const label = document.createElement('label'); label.className = 'smart-object-row'; label.dataset.selected = String(this.selectedIds.has(object.id));
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = this.selectedIds.has(object.id);
      checkbox.addEventListener('change', () => { if (checkbox.checked) this.selectedIds.add(object.id); else this.selectedIds.delete(object.id); this.rebuildMask(); this.renderObjectList(); this.refresh(); });
      const icon = document.createElement('span'); icon.className = 'smart-object-icon'; icon.textContent = CATEGORY_ICONS[object.category] ?? CATEGORY_ICONS.other;
      const text = document.createElement('span'); const name = document.createElement('strong'); name.textContent = object.categoryLabel;
      const detail = document.createElement('small'); detail.textContent = `${object.label} · ${Math.round(object.score * 100)}% · ${sourceLabel(object.source)}`;
      text.append(name, detail); label.append(checkbox, icon, text); list.append(label);
    }
  }

  drawOverlay() {
    if (!this.context || !this.overlay) return;
    const context = this.context; context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.active || !this.analysis) return;
    if (this.currentMask) {
      const imageData = context.createImageData(this.analysis.width, this.analysis.height);
      for (let index = 0; index < this.currentMask.length; index += 1) {
        const offset = index * 4; imageData.data[offset] = 49; imageData.data[offset + 1] = 196; imageData.data[offset + 2] = 141; imageData.data[offset + 3] = Math.round(this.currentMask[index] * 0.32);
      }
      context.putImageData(imageData, 0, 0);
    }
    context.save();
    for (const object of this.analysis.objects) {
      const selected = this.selectedIds.has(object.id); context.strokeStyle = selected ? '#9be8c7' : 'rgba(255,255,255,.48)'; context.lineWidth = selected ? 2 : 1; context.setLineDash(selected ? [] : [6, 4]);
      context.strokeRect(object.bounds.x + 0.5, object.bounds.y + 0.5, object.bounds.width, object.bounds.height);
    }
    if (this.mode !== 'select' && this.hoverPoint) { context.strokeStyle = this.mode === 'add' ? '#8ff0c4' : '#ff8c96'; context.lineWidth = 2; context.setLineDash([]); context.beginPath(); context.arc(this.hoverPoint.x, this.hoverPoint.y, this.settings.brushSize / 2, 0, Math.PI * 2); context.stroke(); }
    context.restore();
  }

  clearOverlay() { this.context?.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  refresh() {
    const e = this.elements;
    if (e.activate) e.activate.dataset.active = String(this.active); if (e.panel) e.panel.dataset.active = String(this.active);
    if (e.analyze) e.analyze.disabled = this.processing || !this.documentModel.layers.length; if (e.cancel) e.cancel.disabled = !this.processing;
    if (e.apply) e.apply.disabled = !this.currentMask || !this.documentModel.activeLayer || this.documentModel.activeLayer.type === 'group';
    if (e.selectAll) e.selectAll.disabled = !this.analysis?.objects.length; if (e.clear) e.clear.disabled = !this.analysis?.objects.length;
    for (const button of e.modeButtons) { button.disabled = !this.analysis; button.dataset.active = String(button.dataset.smartMode === this.mode); }
    this.refreshProgress(); this.refreshOutputs(); this.renderObjectList();
    if (e.backend) { const summary = this.analysis?.backendSummary; e.backend.textContent = summary?.backends?.length ? `${summary.backends.map(backendLabel).join(' + ')} · ${Math.round(summary.totalDurationMs)} ms` : 'Backend: oczekuje'; e.backend.dataset.tone = summary?.backends?.includes('npu') ? 'success' : summary?.backends?.length ? 'warning' : 'neutral'; }
  }

  refreshTarget() { if (!this.active) return; const layer = this.documentModel.activeLayer; if (layer?.type === 'group') this.setStatus('Wybierz warstwę obrazu, aby zastosować maskę.', 'warning'); this.refresh(); }
  refreshProgress() { if (!this.elements.progress || !this.elements.progressBar) return; this.elements.progress.hidden = !this.processing; this.elements.progressBar.style.width = `${clamp(this.progress, 0, 100)}%`; }
  refreshOutputs() {
    const e = this.elements; const values = { feather: `${Math.round(this.settings.feather)} px`, expand: `${Math.round(this.settings.expand)} px`, contract: `${Math.round(this.settings.contract)} px`, threshold: `${Math.round(this.settings.threshold * 100)}%`, softness: `${Math.round(this.settings.softness * 100)}%`, brushSize: `${Math.round(this.settings.brushSize)} px`, brushHardness: `${Math.round(this.settings.brushHardness * 100)}%` };
    for (const [key, value] of Object.entries(values)) if (e[`${key}Out`]) e[`${key}Out`].textContent = value;
  }
  setStatus(message, tone = 'neutral') { if (!this.elements.status) return; this.elements.status.textContent = message; this.elements.status.dataset.tone = tone; }
}

export function ensureSmartSelectUi(root = document) {
  if (root.getElementById?.('smart-select-panel')) return;
  ensureStylesheet(root);
  const rail = root.querySelector?.('.tool-rail');
  if (rail) { const button = root.createElement('button'); button.id = 'smart-select-tool'; button.type = 'button'; button.className = 'tool-button smart-select-tool'; button.title = 'Smart Select (Q)'; button.innerHTML = '<span>◈</span><small>Smart</small>'; rail.insertBefore(button, rail.querySelector('.rail-separator')); }
  const inspector = root.querySelector?.('.inspector'); if (!inspector) return; const retouch = root.getElementById('retouch-panel');
  const panel = root.createElement('details'); panel.id = 'smart-select-panel'; panel.className = 'inspector-section smart-select-section';
  panel.innerHTML = `
    <summary>Smart Select</summary><div class="section-body smart-select-body">
      <div class="smart-actions"><button id="smart-select-analyze" class="panel-button" type="button">Analizuj obraz</button><button id="smart-select-cancel" class="panel-button" type="button" disabled>Anuluj</button></div>
      <p id="smart-select-status" class="smart-status" data-tone="neutral">Uruchom analizę, aby wykryć obiekty i maski semantyczne.</p>
      <div id="smart-select-progress" class="progress-wrap" hidden><div class="progress-track"><span id="smart-select-progress-bar"></span></div></div>
      <span id="smart-select-backend" class="badge smart-backend" data-tone="neutral">Backend: oczekuje</span>
      <div class="smart-mode-row"><button class="panel-button" data-smart-mode="select" type="button" disabled>Wybierz</button><button class="panel-button" data-smart-mode="add" type="button" disabled>Dodaj pędzlem</button><button class="panel-button" data-smart-mode="subtract" type="button" disabled>Odejmij</button></div>
      <div class="smart-list-heading"><strong>Obiekty</strong><span><button id="smart-select-all" type="button" disabled>Wszystkie</button><button id="smart-select-clear" type="button" disabled>Wyczyść</button></span></div>
      <div id="smart-select-object-list" class="smart-object-list"><p class="smart-empty">Uruchom analizę, aby zobaczyć obiekty.</p></div>
      <details class="smart-subsection" open><summary>Refine edge</summary><div class="smart-subsection-body">
        <label><span>Feather <output id="smart-select-feather-output">3 px</output></span><input id="smart-select-feather" type="range" min="0" max="30" value="3" /></label>
        <label><span>Rozszerz <output id="smart-select-expand-output">0 px</output></span><input id="smart-select-expand" type="range" min="0" max="30" value="0" /></label>
        <label><span>Zmniejsz <output id="smart-select-contract-output">0 px</output></span><input id="smart-select-contract" type="range" min="0" max="30" value="0" /></label>
        <label><span>Próg <output id="smart-select-threshold-output">50%</output></span><input id="smart-select-threshold" type="range" min="5" max="95" value="50" /></label>
        <label><span>Miękkość <output id="smart-select-softness-output">12%</output></span><input id="smart-select-softness" type="range" min="1" max="50" value="12" /></label>
      </div></details>
      <details class="smart-subsection"><summary>Pędzel maski</summary><div class="smart-subsection-body"><label><span>Rozmiar <output id="smart-select-brush-size-output">40 px</output></span><input id="smart-select-brush-size" type="range" min="1" max="300" value="40" /></label><label><span>Twardość <output id="smart-select-brush-hardness-output">65%</output></span><input id="smart-select-brush-hardness" type="range" min="0" max="100" value="65" /></label></div></details>
      <button id="smart-select-apply" class="panel-button smart-apply" type="button" disabled>Zapisz jako maskę aktywnej warstwy</button>
      <p class="hint">Kliknij obiekt na płótnie lub wybierz wiele obiektów z listy. MODNet doprecyzowuje osobę, a pędzel pozwala ręcznie poprawić maskę.</p>
    </div>`;
  inspector.insertBefore(panel, retouch ?? inspector.querySelector('details:nth-of-type(3)'));
}

function ensureStylesheet(root) { if (root.querySelector?.('link[data-editor-smart-select-styles]')) return; const link = root.createElement('link'); link.rel = 'stylesheet'; link.href = './editor-smart-select.css'; link.dataset.editorSmartSelectStyles = 'true'; (root.head ?? root.documentElement)?.append(link); }
function cloneCanvas(source, width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(source, 0, 0, width, height); return canvas; }
function backendLabel(backend) { return ({ npu: 'NPU', webgpu: 'GPU', wasm: 'CPU' })[backend] ?? backend; }
function sourceLabel(source) { return ({ modnet: 'MODNet', semantic: 'segmentacja', detection: 'detekcja', 'detection+semantic': 'detekcja + maska' })[source] ?? source; }
function stageLabel(stage) { return ({ semantic: 'Segmentacja semantyczna', detection: 'Detekcja obiektów', person: 'Refine osoby', complete: 'Gotowe' })[stage] ?? 'Analiza obrazu'; }
function isEditable(target) { return target?.matches?.('input, textarea, select, [contenteditable="true"]'); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
