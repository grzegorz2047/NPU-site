import { addLayerCommand } from './editor-history.js';
import { createGroupLayer, createId, createLayerMask } from './editor-document.js';
import { rasterizeSelection } from './editor-selection.js';
import { createAppendRetouchStrokeCommand, findRetouchLayer } from './editor-retouch-commands.js';
import {
  createRetouchLayerMetadata,
  createRetouchStroke,
  isRetouchLayer,
  resolveStrokeSourceOffset,
  sourcePointForDestination
} from './editor-retouch.js';
import { RetouchProcessor } from './editor-retouch-processor.js';

const TOOL_LABELS = Object.freeze({ clone: 'Clone stamp', healing: 'Healing brush', 'spot-healing': 'Spot healing' });
const TOOL_ICONS = Object.freeze({ clone: '◎', healing: '✦', 'spot-healing': '•' });

export class RetouchController {
  constructor({ documentModel, history, renderer, canvasController, toolsController, root = document, processor = new RetouchProcessor() } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.canvasController = canvasController;
    this.toolsController = toolsController;
    this.root = root;
    this.processor = processor;
    this.tool = null;
    this.sourcePoint = null;
    this.alignedOffset = null;
    this.sampleLayerId = findSampleLayer(documentModel)?.id ?? null;
    this.preferredLayerId = null;
    this.hoverPoint = null;
    this.stroke = null;
    this.previewSourceCanvas = null;
    this.processingController = null;
    this.settings = {
      size: 42,
      hardness: 0.58,
      opacity: 1,
      flow: 0.72,
      spacing: 0.16,
      aligned: true,
      sampleMode: 'all'
    };
    ensureRetouchUi(root);
    this.elements = this.resolveElements();
    this.overlay = root.getElementById('overlay-canvas');
    this.context = this.overlay?.getContext('2d');
    this.bind();
    this.unsubscribe = documentModel.subscribe(() => this.refresh());
    this.refresh();
  }

  destroy() {
    this.unsubscribe?.();
    this.processor.dispose();
  }

  resolveElements() {
    const get = id => this.root.getElementById(id);
    return {
      panel: get('retouch-panel'),
      active: get('retouch-active-tool'),
      status: get('retouch-source-status'),
      size: get('retouch-size'),
      sizeOut: get('retouch-size-output'),
      hardness: get('retouch-hardness'),
      hardnessOut: get('retouch-hardness-output'),
      opacity: get('retouch-opacity'),
      opacityOut: get('retouch-opacity-output'),
      flow: get('retouch-flow'),
      flowOut: get('retouch-flow-output'),
      spacing: get('retouch-spacing'),
      spacingOut: get('retouch-spacing-output'),
      aligned: get('retouch-aligned'),
      sampleMode: get('retouch-sample-mode'),
      newLayer: get('retouch-new-layer'),
      cancel: get('retouch-cancel'),
      buttons: [...this.root.querySelectorAll('[data-retouch-tool]')]
    };
  }

  bind() {
    for (const button of this.elements.buttons) button.addEventListener('click', () => this.activate(button.dataset.retouchTool));
    for (const key of ['size', 'hardness', 'opacity', 'flow', 'spacing']) {
      this.elements[key]?.addEventListener('input', () => {
        const raw = Number(this.elements[key].value);
        this.settings[key] = key === 'size' ? raw : raw / 100;
        this.refreshOutputs();
        this.drawOverlay();
      });
    }
    this.elements.aligned?.addEventListener('change', () => {
      this.settings.aligned = this.elements.aligned.checked;
      if (!this.settings.aligned) this.alignedOffset = null;
      this.drawOverlay();
    });
    this.elements.sampleMode?.addEventListener('change', () => {
      this.settings.sampleMode = this.elements.sampleMode.value;
      this.previewSourceCanvas = null;
      this.refreshSourceStatus();
    });
    this.elements.newLayer?.addEventListener('click', () => this.createLayer());
    this.elements.cancel?.addEventListener('click', () => this.cancelProcessing());
    this.overlay?.addEventListener('pointerdown', event => this.pointerDown(event));
    this.overlay?.addEventListener('pointermove', event => this.pointerMove(event));
    this.overlay?.addEventListener('pointerup', event => this.pointerUp(event));
    this.overlay?.addEventListener('pointercancel', event => this.pointerCancel(event));
    this.overlay?.addEventListener('pointerleave', () => {
      if (!this.stroke) { this.hoverPoint = null; this.drawOverlay(); }
    });
    this.root.addEventListener('keydown', event => this.keyDown(event));
    for (const button of this.root.querySelectorAll('[data-manual-tool]')) button.addEventListener('click', () => this.deactivate());
  }

  activate(tool) {
    if (!TOOL_LABELS[tool]) return;
    const active = this.documentModel.activeLayer;
    if (active && !isRetouchLayer(active) && active.type !== 'group') this.sampleLayerId = active.id;
    this.tool = tool;
    this.toolsController?.setTool?.('none');
    if (this.elements.panel) this.elements.panel.open = true;
    this.refresh();
    this.drawOverlay();
  }

  deactivate() {
    if (!this.tool) return;
    this.tool = null;
    this.stroke = null;
    this.hoverPoint = null;
    this.drawOverlay();
    this.refresh();
  }

  keyDown(event) {
    if (isEditable(event.target) || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      this.activate('clone');
    } else if (key === 'j' && event.shiftKey) {
      event.preventDefault();
      this.activate('spot-healing');
    } else if (key === 'j') {
      event.preventDefault();
      this.activate('healing');
    } else if (['b', 'e', 'f', 'g', 'i', 'm', 't', 'u', 'w'].includes(key)) {
      this.deactivate();
    } else if (key === 'escape' && this.processingController) {
      this.cancelProcessing();
    }
  }

  async pointerDown(event) {
    if (!this.tool || event.button !== 0 || this.processingController) return;
    const point = this.point(event);
    this.hoverPoint = point;
    if (event.altKey) {
      event.preventDefault();
      this.sourcePoint = point;
      this.alignedOffset = null;
      this.previewSourceCanvas = await this.captureSourceCanvas();
      this.refreshSourceStatus();
      this.drawOverlay();
      return;
    }
    if (this.tool !== 'spot-healing' && !this.sourcePoint) {
      this.setStatus('Ustaw źródło przez Alt/Option+klik na płótnie.', 'warning');
      this.drawOverlay();
      return;
    }
    event.preventDefault();
    this.overlay.setPointerCapture?.(event.pointerId);
    const sourceCanvas = await this.captureSourceCanvas();
    const sourceOffset = resolveStrokeSourceOffset({
      tool: this.tool,
      aligned: this.settings.aligned,
      sourcePoint: this.sourcePoint,
      destinationStart: point,
      alignedOffset: this.alignedOffset,
      width: this.documentModel.width,
      height: this.documentModel.height,
      size: this.settings.size
    });
    if (this.settings.aligned && this.tool !== 'spot-healing') this.alignedOffset = sourceOffset;
    this.stroke = {
      pointerId: event.pointerId,
      points: [point],
      sourceCanvas,
      sourceOffset,
      sampleLayerId: this.settings.sampleMode === 'current' ? this.sampleLayerId : null
    };
    this.previewSourceCanvas = sourceCanvas;
    this.drawOverlay();
  }

  pointerMove(event) {
    if (!this.tool) return;
    const point = this.point(event);
    this.hoverPoint = point;
    if (this.stroke?.pointerId === event.pointerId) this.stroke.points.push(point);
    this.drawOverlay();
  }

  async pointerUp(event) {
    if (!this.stroke || this.stroke.pointerId !== event.pointerId) return;
    this.overlay.releasePointerCapture?.(event.pointerId);
    const pending = this.stroke;
    this.stroke = null;
    await this.commitStroke(pending);
    this.drawOverlay();
  }

  pointerCancel(event) {
    if (!this.stroke || this.stroke.pointerId !== event.pointerId) return;
    this.stroke = null;
    this.overlay.releasePointerCapture?.(event.pointerId);
    this.drawOverlay();
  }

  async commitStroke(pending) {
    const canvas = pending.sourceCanvas;
    if (!canvas) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let source;
    try {
      source = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (error) {
      this.setStatus(`Nie można odczytać źródła: ${error.message}`, 'danger');
      return;
    }
    const selection = this.documentModel.metadata?.selection;
    const selectionMask = selection?.entries?.length
      ? rasterizeSelection(selection, this.documentModel.width, this.documentModel.height)
      : null;
    const descriptor = createRetouchStroke(pending.points, {
      tool: this.tool,
      size: this.settings.size,
      hardness: this.settings.hardness,
      opacity: this.settings.opacity,
      flow: this.settings.flow,
      spacing: this.settings.spacing,
      aligned: this.settings.aligned,
      sampleMode: this.settings.sampleMode,
      sampleLayerId: pending.sampleLayerId,
      sourcePoint: this.sourcePoint,
      sourceOffset: pending.sourceOffset,
      selection: selection ? clone(selection) : null
    });
    this.processingController = new AbortController();
    this.refresh();
    this.setStatus('Przetwarzanie pociągnięcia retuszu…', 'neutral');
    try {
      const result = await this.processor.process(source, canvas.width, canvas.height, descriptor, selectionMask, { signal: this.processingController.signal });
      const patchAssetId = createId('retouch-patch');
      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = result.bounds.width;
      patchCanvas.height = result.bounds.height;
      const patchContext = patchCanvas.getContext('2d');
      const imageData = patchContext.createImageData(patchCanvas.width, patchCanvas.height);
      imageData.data.set(result.data);
      patchContext.putImageData(imageData, 0, 0);
      this.documentModel.setRuntimeAsset(patchAssetId, patchCanvas);
      const layer = findRetouchLayer(this.documentModel, this.preferredLayerId);
      this.history.execute(createAppendRetouchStrokeCommand({
        ...result.stroke,
        patchAssetId,
        bounds: result.bounds
      }, { layerId: layer?.id ?? null, layerName: TOOL_LABELS[this.tool] }), this.documentModel);
      this.preferredLayerId = this.documentModel.activeLayerId;
      this.renderer.render(this.documentModel);
      this.setStatus(`${TOOL_LABELS[this.tool]}: pociągnięcie zapisane jako osobna operacja undo.`, 'success');
    } catch (error) {
      if (error?.name !== 'AbortError') this.setStatus(error.message || String(error), 'danger');
      else this.setStatus('Retusz anulowany.', 'warning');
    } finally {
      this.processingController = null;
      this.refresh();
    }
  }

  createLayer() {
    const layer = createGroupLayer({
      name: 'Nowa warstwa retuszu',
      metadata: createRetouchLayerMetadata(),
      mask: createLayerMask({ enabled: true, metadata: { mode: 'full' } }),
      children: []
    });
    this.history.execute(addLayerCommand(layer), this.documentModel);
    this.preferredLayerId = layer.id;
    this.renderer.render(this.documentModel);
    this.refresh();
  }

  cancelProcessing() {
    if (!this.processingController) return false;
    this.processingController.abort('Retusz anulowany przez użytkownika.');
    return true;
  }

  async captureSourceCanvas() {
    if (!this.documentModel.layers.length) throw new Error('Załaduj obraz przed retuszem.');
    if (this.settings.sampleMode === 'current') {
      const layer = this.documentModel.getLayer(this.sampleLayerId) ?? findSampleLayer(this.documentModel);
      if (layer) return cloneCanvas(this.renderer.renderLayer(layer, this.documentModel), this.documentModel.width, this.documentModel.height);
    }
    this.renderer.render(this.documentModel);
    return cloneCanvas(this.renderer.canvas, this.documentModel.width, this.documentModel.height);
  }

  point(event) {
    const point = this.canvasController.viewport.clientToDocument(event.clientX, event.clientY);
    return {
      x: clamp(point.x, 0, this.documentModel.width - 1),
      y: clamp(point.y, 0, this.documentModel.height - 1),
      pressure: event.pressure > 0 ? event.pressure : 1
    };
  }

  drawOverlay() {
    if (!this.context || !this.overlay) return;
    const context = this.context;
    context.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.tool || !this.hoverPoint) return;
    const radius = this.settings.size / 2;
    const previewStroke = this.stroke ? createRetouchStroke(this.stroke.points, {
      tool: this.tool,
      size: this.settings.size,
      hardness: this.settings.hardness,
      opacity: this.settings.opacity,
      flow: this.settings.flow,
      spacing: this.settings.spacing,
      aligned: this.settings.aligned,
      sampleMode: this.settings.sampleMode,
      sourcePoint: this.sourcePoint,
      sourceOffset: this.stroke.sourceOffset
    }) : null;
    let source = null;
    if (this.tool === 'spot-healing') {
      const offset = resolveStrokeSourceOffset({ tool: this.tool, destinationStart: this.hoverPoint, width: this.documentModel.width, height: this.documentModel.height, size: this.settings.size });
      source = { x: this.hoverPoint.x + offset.x, y: this.hoverPoint.y + offset.y };
    } else if (previewStroke) source = sourcePointForDestination(previewStroke, this.hoverPoint);
    else if (this.sourcePoint) {
      const offset = this.settings.aligned && this.alignedOffset
        ? this.alignedOffset
        : { x: this.sourcePoint.x - this.hoverPoint.x, y: this.sourcePoint.y - this.hoverPoint.y };
      source = { x: this.hoverPoint.x + offset.x, y: this.hoverPoint.y + offset.y };
    }
    if (source && this.previewSourceCanvas) {
      context.save();
      context.beginPath();
      context.arc(this.hoverPoint.x, this.hoverPoint.y, radius, 0, Math.PI * 2);
      context.clip();
      context.globalAlpha = this.tool === 'clone' ? 0.55 : 0.35;
      context.drawImage(this.previewSourceCanvas, source.x - radius, source.y - radius, radius * 2, radius * 2, this.hoverPoint.x - radius, this.hoverPoint.y - radius, radius * 2, radius * 2);
      context.restore();
    }
    drawCircle(context, this.hoverPoint, radius, this.settings.hardness);
    if (source) drawSourceMarker(context, source, radius);
    if (this.stroke?.points?.length > 1) {
      context.save();
      context.strokeStyle = 'rgba(255,255,255,.55)';
      context.lineWidth = 1;
      context.beginPath();
      this.stroke.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.stroke();
      context.restore();
    }
  }

  refresh() {
    const active = Boolean(this.tool);
    for (const button of this.elements.buttons) button.dataset.active = String(button.dataset.retouchTool === this.tool);
    if (this.elements.active) this.elements.active.textContent = active ? TOOL_LABELS[this.tool] : 'Narzędzie nieaktywne';
    if (this.elements.panel) this.elements.panel.dataset.active = String(active);
    if (this.elements.cancel) this.elements.cancel.disabled = !this.processingController;
    this.syncInputs();
    this.refreshSourceStatus();
    this.decorateLayers();
  }

  syncInputs() {
    const e = this.elements;
    if (e.size) e.size.value = this.settings.size;
    if (e.hardness) e.hardness.value = Math.round(this.settings.hardness * 100);
    if (e.opacity) e.opacity.value = Math.round(this.settings.opacity * 100);
    if (e.flow) e.flow.value = Math.round(this.settings.flow * 100);
    if (e.spacing) e.spacing.value = Math.round(this.settings.spacing * 100);
    if (e.aligned) e.aligned.checked = this.settings.aligned;
    if (e.sampleMode) e.sampleMode.value = this.settings.sampleMode;
    this.refreshOutputs();
  }

  refreshOutputs() {
    const e = this.elements;
    if (e.sizeOut) e.sizeOut.textContent = `${Math.round(this.settings.size)} px`;
    if (e.hardnessOut) e.hardnessOut.textContent = `${Math.round(this.settings.hardness * 100)}%`;
    if (e.opacityOut) e.opacityOut.textContent = `${Math.round(this.settings.opacity * 100)}%`;
    if (e.flowOut) e.flowOut.textContent = `${Math.round(this.settings.flow * 100)}%`;
    if (e.spacingOut) e.spacingOut.textContent = `${Math.round(this.settings.spacing * 100)}%`;
  }

  refreshSourceStatus() {
    if (!this.elements.status) return;
    if (!this.tool) return this.setStatus('Wybierz Clone stamp, Healing brush lub Spot healing.', 'neutral');
    if (this.tool === 'spot-healing') return this.setStatus('Źródło jest wybierane automatycznie z sąsiedniego obszaru.', 'success');
    if (!this.sourcePoint) return this.setStatus('Alt/Option+klik ustawia źródło próbki.', 'warning');
    const mode = this.settings.sampleMode === 'all' ? 'wszystkie warstwy' : `warstwa: ${this.documentModel.getLayer(this.sampleLayerId)?.name ?? 'bieżąca'}`;
    this.setStatus(`Źródło: ${Math.round(this.sourcePoint.x)}, ${Math.round(this.sourcePoint.y)} · ${mode}`, 'success');
  }

  setStatus(message, tone = 'neutral') {
    if (!this.elements.status) return;
    this.elements.status.textContent = message;
    this.elements.status.dataset.tone = tone;
  }

  decorateLayers() {
    for (const row of this.root.querySelectorAll('.layer-row')) {
      const layer = this.documentModel.getLayer(row.dataset.layerId);
      if (!isRetouchLayer(layer)) continue;
      row.dataset.retouch = 'true';
      const thumbnail = row.querySelector('.layer-thumbnail');
      if (thumbnail) {
        thumbnail.textContent = '✦';
        thumbnail.classList.add('layer-thumbnail-retouch');
        thumbnail.title = `Warstwa retuszu · ${layer.metadata.strokes.length} pociągnięć`;
      }
    }
  }
}

export function ensureRetouchUi(root = document) {
  if (root.getElementById?.('retouch-panel')) return;
  ensureStylesheet(root);
  const rail = root.querySelector?.('.tool-rail');
  const anchor = rail?.querySelector('.rail-separator');
  if (rail) {
    for (const tool of ['clone', 'healing', 'spot-healing']) {
      const button = root.createElement('button');
      button.type = 'button';
      button.className = 'tool-button retouch-tool-button';
      button.dataset.retouchTool = tool;
      button.title = `${TOOL_LABELS[tool]} (${tool === 'clone' ? 'S' : tool === 'healing' ? 'J' : 'Shift+J'})`;
      button.innerHTML = `<span>${TOOL_ICONS[tool]}</span><small>${tool === 'spot-healing' ? 'Spot' : tool === 'healing' ? 'Healing' : 'Clone'}</small>`;
      rail.insertBefore(button, anchor ?? null);
    }
  }
  const inspector = root.querySelector?.('.inspector');
  if (!inspector) return;
  const adjustmentPanel = root.getElementById('adjustments-panel');
  const panel = root.createElement('details');
  panel.id = 'retouch-panel';
  panel.className = 'inspector-section retouch-section';
  panel.innerHTML = `
    <summary>Retusz lokalny</summary>
    <div class="section-body retouch-panel-body">
      <div class="retouch-heading"><strong id="retouch-active-tool">Narzędzie nieaktywne</strong><small>S / J / Shift+J</small></div>
      <p id="retouch-source-status" class="retouch-status" data-tone="neutral">Wybierz narzędzie retuszu.</p>
      <label><span>Rozmiar <output id="retouch-size-output">42 px</output></span><input id="retouch-size" type="range" min="1" max="300" value="42" /></label>
      <label><span>Twardość <output id="retouch-hardness-output">58%</output></span><input id="retouch-hardness" type="range" min="0" max="100" value="58" /></label>
      <label><span>Krycie <output id="retouch-opacity-output">100%</output></span><input id="retouch-opacity" type="range" min="1" max="100" value="100" /></label>
      <label><span>Przepływ <output id="retouch-flow-output">72%</output></span><input id="retouch-flow" type="range" min="1" max="100" value="72" /></label>
      <label><span>Odstęp <output id="retouch-spacing-output">16%</output></span><input id="retouch-spacing" type="range" min="2" max="100" value="16" /></label>
      <label>Próbkuj<select id="retouch-sample-mode"><option value="all">Wszystkie warstwy</option><option value="current">Bieżąca warstwa</option></select></label>
      <label class="retouch-check"><input id="retouch-aligned" type="checkbox" checked /> Wyrównane źródło między pociągnięciami</label>
      <div class="retouch-actions"><button id="retouch-new-layer" class="panel-button" type="button">Nowa warstwa retuszu</button><button id="retouch-cancel" class="panel-button" type="button" disabled>Anuluj</button></div>
      <p class="hint">Alt/Option+klik ustawia źródło. Każde pociągnięcie jest osobną operacją undo i trafia na warstwę retuszu.</p>
    </div>`;
  inspector.insertBefore(panel, adjustmentPanel ?? inspector.querySelector('details:nth-of-type(3)'));
}

function findSampleLayer(documentModel) {
  const active = documentModel.activeLayer;
  if (active && !isRetouchLayer(active) && active.type !== 'group') return active;
  return [...documentModel.layers].reverse().find(layer => !isRetouchLayer(layer) && layer.type !== 'group') ?? null;
}

function cloneCanvas(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return canvas;
}

function drawCircle(context, point, radius, hardness) {
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = '#fff';
  context.setLineDash([]);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = 'rgba(0,0,0,.8)';
  context.setLineDash([3, 3]);
  context.beginPath();
  context.arc(point.x, point.y, radius * Math.max(0.08, hardness), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawSourceMarker(context, point, radius) {
  context.save();
  context.strokeStyle = '#31c48d';
  context.lineWidth = 2;
  context.setLineDash([]);
  context.beginPath();
  context.arc(point.x, point.y, Math.max(6, radius * 0.28), 0, Math.PI * 2);
  context.moveTo(point.x - 10, point.y);
  context.lineTo(point.x + 10, point.y);
  context.moveTo(point.x, point.y - 10);
  context.lineTo(point.x, point.y + 10);
  context.stroke();
  context.restore();
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-retouch-styles]')) return;
  const link = root.createElement('link');
  link.rel = 'stylesheet';
  link.href = './editor-retouch.css';
  link.dataset.editorRetouchStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}

function isEditable(target) { return target?.matches?.('input, textarea, select, [contenteditable="true"]'); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
