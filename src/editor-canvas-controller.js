import { createTransform } from './editor-document.js';
import { ensureCanvasUi } from './editor-canvas-ui.js';
import { createDocumentCommand } from './editor-history.js';
import {
  createAddGuideCommand,
  createCanvasPreferencesCommand,
  createCropDocumentCommand,
  createRemoveGuideCommand,
  createResizeDocumentCommand,
  createResizeLayerCommand,
  createSetTransformCommand,
  getCanvasMetadata
} from './editor-canvas-commands.js';
import {
  createViewport,
  documentToScreen,
  fitViewport,
  normalizeRect,
  panViewport,
  QUICK_ZOOMS,
  screenToDocument,
  snapPoint,
  transformedBounds,
  zoomAtPoint
} from './editor-canvas-geometry.js';

const MODE_LABELS = Object.freeze({ navigate: 'Nawigacja', hand: 'Przesuwanie', crop: 'Kadrowanie', transform: 'Transformacja' });

export class CanvasController {
  constructor({ documentModel, history, renderer, root = document } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.root = root;
    ensureCanvasUi(this.root);
    this.elements = this.resolveElements();
    this.viewport = createViewport(documentModel.metadata?.viewport);
    this.mode = 'navigate';
    this.spacePressed = false;
    this.pointerSession = null;
    this.pendingTransform = null;
    this.pendingLayerId = null;
    this.cropRect = null;
    this.cropAngle = 0;
    this.persistTimer = null;
    this.resizeObserver = null;
    this.unsubscribe = this.documentModel.subscribe(event => this.handleDocumentEvent(event));
    this.bind();
    this.refreshDocumentControls();
    this.applyViewport();
    this.renderOverlay();
    this.scheduleFit();
  }

  destroy() {
    this.unsubscribe?.();
    this.resizeObserver?.disconnect();
    clearTimeout(this.persistTimer);
  }

  resolveElements() {
    const get = id => this.root.getElementById?.(id) ?? this.root.querySelector?.(`#${id}`);
    return {
      stage: get('dropzone'),
      card: get('canvas-card') ?? this.root.querySelector?.('.canvas-card'),
      stack: this.root.querySelector?.('.canvas-stack'),
      canvas: get('result-canvas'),
      overlay: get('canvas-ui-overlay'),
      rulerX: get('canvas-ruler-x'),
      rulerY: get('canvas-ruler-y'),
      zoomOut: get('zoom-out'), zoomIn: get('zoom-in'), zoomValue: get('zoom-value'), zoomFit: get('zoom-fit'), zoom100: get('zoom-100'),
      hand: get('hand-tool'), crop: get('crop-tool'), transform: get('transform-tool'),
      grid: get('grid-toggle'), snap: get('snap-toggle'), guides: get('guides-toggle'), clearGuides: get('clear-guides'),
      cropRatio: get('crop-ratio'), cropAngle: get('crop-angle'), cropApply: get('crop-apply'), cropCancel: get('crop-cancel'), cropPanel: get('crop-controls'),
      transformPanel: get('transform-controls'), transformApply: get('transform-apply'), transformCancel: get('transform-cancel'), straighten: get('straighten-angle'),
      transformInputs: {
        x: get('transform-x'), y: get('transform-y'), scaleX: get('transform-scale-x'), scaleY: get('transform-scale-y'), rotation: get('transform-rotation'),
        skewX: get('transform-skew-x'), skewY: get('transform-skew-y'), perspectiveX: get('transform-perspective-x'), perspectiveY: get('transform-perspective-y')
      },
      width: get('canvas-width'), height: get('canvas-height'), interpolation: get('resize-interpolation'), scaleLayers: get('resize-scale-layers'),
      resizeDocument: get('resize-document'), resizeLayer: get('resize-layer'),
      modeStatus: get('canvas-mode-status')
    };
  }

  bind() {
    const e = this.elements;
    e.zoomOut?.addEventListener('click', () => this.stepZoom(-1));
    e.zoomIn?.addEventListener('click', () => this.stepZoom(1));
    e.zoomFit?.addEventListener('click', () => this.fit());
    e.zoom100?.addEventListener('click', () => this.setZoom(1));
    e.zoomValue?.addEventListener('change', () => this.setZoom(Number(e.zoomValue.value) / 100));
    e.hand?.addEventListener('click', () => this.setMode(this.mode === 'hand' ? 'navigate' : 'hand'));
    e.crop?.addEventListener('click', () => this.setMode(this.mode === 'crop' ? 'navigate' : 'crop'));
    e.transform?.addEventListener('click', () => this.setMode(this.mode === 'transform' ? 'navigate' : 'transform'));
    e.grid?.addEventListener('change', () => this.execute(createCanvasPreferencesCommand({ gridEnabled: e.grid.checked })));
    e.snap?.addEventListener('change', () => this.execute(createCanvasPreferencesCommand({ snapping: e.snap.checked })));
    e.guides?.addEventListener('change', () => this.execute(createCanvasPreferencesCommand({ guidesVisible: e.guides.checked })));
    e.clearGuides?.addEventListener('click', () => this.execute(createDocumentCommand('Wyczyść prowadnice', documentModel => {
      const canvas = getCanvasMetadata(documentModel);
      canvas.guides = { vertical: [], horizontal: [] };
      documentModel.metadata = { ...documentModel.metadata, canvas };
      documentModel.touch();
      documentModel.emit('guide:clear');
    })));
    e.cropAngle?.addEventListener('input', () => { this.cropAngle = Number(e.cropAngle.value) || 0; this.renderOverlay(); });
    e.cropRatio?.addEventListener('change', () => { if (this.cropRect) this.cropRect = this.constrainCrop(this.cropRect); this.renderOverlay(); });
    e.cropApply?.addEventListener('click', () => this.applyCrop());
    e.cropCancel?.addEventListener('click', () => this.cancelCrop());
    e.transformApply?.addEventListener('click', () => this.applyTransform());
    e.transformCancel?.addEventListener('click', () => this.cancelTransform());
    e.straighten?.addEventListener('input', () => {
      this.ensurePendingTransform();
      if (!this.pendingTransform) return;
      this.pendingTransform.rotation = -Number(e.straighten.value || 0);
      this.syncTransformInputs();
      this.renderPreview();
    });
    for (const [key, input] of Object.entries(e.transformInputs)) input?.addEventListener('input', () => this.updatePendingTransform(key, Number(input.value)));
    e.resizeDocument?.addEventListener('click', () => this.resizeDocument());
    e.resizeLayer?.addEventListener('click', () => this.resizeLayer());
    e.stage?.addEventListener('wheel', event => this.handleWheel(event), { passive: false });
    e.stage?.addEventListener('pointerdown', event => this.handlePointerDown(event), true);
    globalThis.addEventListener?.('pointermove', event => this.handlePointerMove(event));
    globalThis.addEventListener?.('pointerup', event => this.handlePointerUp(event));
    this.root.addEventListener?.('keydown', event => this.handleKeyDown(event));
    this.root.addEventListener?.('keyup', event => this.handleKeyUp(event));
    e.rulerX?.addEventListener('dblclick', event => this.addGuideFromRuler('vertical', event));
    e.rulerY?.addEventListener('dblclick', event => this.addGuideFromRuler('horizontal', event));
    e.rulerX?.addEventListener('contextmenu', event => this.removeGuideFromRuler('vertical', event));
    e.rulerY?.addEventListener('contextmenu', event => this.removeGuideFromRuler('horizontal', event));

    if (typeof ResizeObserver !== 'undefined' && e.stage) {
      this.resizeObserver = new ResizeObserver(() => { this.resizeRulers(); this.renderOverlay(); });
      this.resizeObserver.observe(e.stage);
    }
  }

  handleDocumentEvent(event) {
    if (event.type === 'selection:change') this.cancelTransform(false);
    if (['document:restore', 'document:resize', 'document:crop'].includes(event.type)) {
      this.pendingTransform = null;
      this.cropRect = null;
      this.refreshDocumentControls();
      this.fit();
    }
    this.refreshPreferences();
    this.renderOverlay();
  }

  scheduleFit() {
    const run = () => this.fit();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  applyViewport({ persist = true } = {}) {
    const { card, zoomValue, modeStatus } = this.elements;
    if (card) card.style.transform = `translate(${this.viewport.panX}px, ${this.viewport.panY}px) scale(${this.viewport.zoom})`;
    if (zoomValue) zoomValue.value = String(Math.round(this.viewport.zoom * 100));
    if (modeStatus) modeStatus.textContent = `${MODE_LABELS[this.mode]} · ${Math.round(this.viewport.zoom * 100)}%`;
    this.resizeRulers();
    this.drawRulers();
    this.renderOverlay();
    if (persist) this.schedulePersistViewport();
  }

  setZoom(zoom, anchor = null) {
    const stage = this.elements.stage;
    const point = anchor ?? { x: (stage?.clientWidth ?? 0) / 2, y: (stage?.clientHeight ?? 0) / 2 };
    this.viewport = zoomAtPoint(this.viewport, zoom, point);
    this.applyViewport();
  }

  stepZoom(direction) {
    const current = this.viewport.zoom;
    const levels = QUICK_ZOOMS;
    const next = direction > 0
      ? levels.find(level => level > current + 1e-6) ?? current * 1.25
      : [...levels].reverse().find(level => level < current - 1e-6) ?? current / 1.25;
    this.setZoom(next);
  }

  fit() {
    const stage = this.elements.stage;
    if (!stage) return;
    this.viewport = fitViewport({ width: stage.clientWidth, height: stage.clientHeight }, this.documentModel, 48);
    this.applyViewport();
  }

  handleWheel(event) {
    if (!this.elements.stage) return;
    event.preventDefault();
    const rect = this.elements.stage.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey || event.altKey) {
      const factor = Math.exp(-event.deltaY * 0.0025);
      this.setZoom(this.viewport.zoom * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else {
      this.viewport = panViewport(this.viewport, { x: -event.deltaX, y: -event.deltaY });
      this.applyViewport();
    }
  }

  handlePointerDown(event) {
    if (isEditable(event.target)) return;
    const panGesture = event.button === 1 || this.spacePressed || this.mode === 'hand';
    if (panGesture) {
      event.preventDefault();
      event.stopPropagation();
      this.pointerSession = { type: 'pan', x: event.clientX, y: event.clientY, viewport: { ...this.viewport } };
      this.elements.stage?.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (this.mode === 'crop') {
      event.preventDefault();
      event.stopPropagation();
      const point = this.eventDocumentPoint(event);
      this.pointerSession = { type: 'crop', start: point };
      this.cropRect = { x: point.x, y: point.y, width: 0, height: 0 };
      this.renderOverlay();
      return;
    }
    if (this.mode === 'transform') {
      const layer = this.documentModel.activeLayer;
      if (!layer || layer.locked) return;
      event.preventDefault();
      event.stopPropagation();
      this.ensurePendingTransform();
      const point = this.eventDocumentPoint(event);
      const bounds = this.activeLayerBounds(this.pendingTransform);
      const action = this.transformHitTest(point, bounds);
      this.pointerSession = { type: 'transform', action, start: point, startTransform: { ...this.pendingTransform }, bounds };
    }
  }

  handlePointerMove(event) {
    const session = this.pointerSession;
    if (!session) return;
    if (session.type === 'pan') {
      this.viewport = { ...session.viewport, panX: session.viewport.panX + event.clientX - session.x, panY: session.viewport.panY + event.clientY - session.y };
      this.applyViewport({ persist: false });
      return;
    }
    if (session.type === 'crop') {
      const point = this.eventDocumentPoint(event);
      this.cropRect = this.constrainCrop({ x: session.start.x, y: session.start.y, width: point.x - session.start.x, height: point.y - session.start.y });
      this.renderOverlay();
      return;
    }
    if (session.type === 'transform') this.updateTransformDrag(event, session);
  }

  handlePointerUp() {
    if (!this.pointerSession) return;
    const type = this.pointerSession.type;
    this.pointerSession = null;
    if (type === 'pan') this.schedulePersistViewport();
    if (type === 'crop' && this.cropRect) this.cropRect = this.constrainCrop(this.cropRect);
    this.renderOverlay();
  }

  updateTransformDrag(event, session) {
    const point = this.eventDocumentPoint(event);
    const start = session.startTransform;
    if (session.action === 'move') {
      const candidate = { x: start.x + point.x - session.start.x, y: start.y + point.y - session.start.y };
      const preferences = getCanvasMetadata(this.documentModel);
      const snapped = snapPoint(candidate, {
        enabled: preferences.snapping,
        zoom: this.viewport.zoom,
        threshold: 8,
        guides: preferences.guides,
        gridEnabled: preferences.gridEnabled,
        gridSize: preferences.gridSize,
        documentSize: this.documentModel
      });
      this.pendingTransform = { ...start, x: snapped.x, y: snapped.y };
    } else if (session.action === 'rotate') {
      const center = { x: session.bounds.x + session.bounds.width / 2, y: session.bounds.y + session.bounds.height / 2 };
      const startAngle = Math.atan2(session.start.y - center.y, session.start.x - center.x);
      const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
      let rotation = start.rotation + (currentAngle - startAngle) * 180 / Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      this.pendingTransform = { ...start, rotation };
    } else {
      const dx = point.x - session.start.x;
      const dy = point.y - session.start.y;
      const width = Math.max(1, session.bounds.width);
      const height = Math.max(1, session.bounds.height);
      let scaleX = Math.max(0.01, start.scaleX * (1 + dx / width * (session.action.includes('left') ? -1 : 1)));
      let scaleY = Math.max(0.01, start.scaleY * (1 + dy / height * (session.action.includes('top') ? -1 : 1)));
      if (event.shiftKey) scaleX = scaleY = Math.max(scaleX, scaleY);
      this.pendingTransform = { ...start, scaleX, scaleY };
    }
    this.syncTransformInputs();
    this.renderPreview();
  }

  setMode(mode) {
    if (!MODE_LABELS[mode]) mode = 'navigate';
    if (this.mode === 'crop' && mode !== 'crop') this.cancelCrop(false);
    if (this.mode === 'transform' && mode !== 'transform') this.cancelTransform(false);
    this.mode = mode;
    this.elements.hand?.classList.toggle('active', mode === 'hand');
    this.elements.crop?.classList.toggle('active', mode === 'crop');
    this.elements.transform?.classList.toggle('active', mode === 'transform');
    if (this.elements.stage) this.elements.stage.style.cursor = mode === 'hand' ? 'grab' : mode === 'crop' ? 'crosshair' : 'default';
    if (this.elements.cropPanel) this.elements.cropPanel.hidden = mode !== 'crop';
    if (this.elements.transformPanel) this.elements.transformPanel.hidden = mode !== 'transform';
    if (mode === 'crop') this.startCrop();
    if (mode === 'transform') this.ensurePendingTransform();
    this.applyViewport({ persist: false });
  }

  startCrop() {
    this.cropRect = { x: 0, y: 0, width: this.documentModel.width, height: this.documentModel.height };
    this.cropAngle = Number(this.elements.cropAngle?.value) || 0;
    this.renderOverlay();
  }

  applyCrop() {
    if (!this.cropRect) return;
    this.execute(createCropDocumentCommand(this.cropRect, { angle: this.cropAngle, bounds: { x: 0, y: 0, width: this.documentModel.width, height: this.documentModel.height } }));
    this.cropRect = null;
    this.setMode('navigate');
    this.fit();
  }

  cancelCrop(resetMode = true) {
    this.cropRect = null;
    this.cropAngle = 0;
    if (this.elements.cropAngle) this.elements.cropAngle.value = '0';
    if (resetMode && this.mode === 'crop') this.setMode('navigate');
    else this.renderOverlay();
  }

  ensurePendingTransform() {
    const layer = this.documentModel.activeLayer;
    if (!layer || layer.locked) {
      this.pendingTransform = null;
      this.pendingLayerId = null;
      this.syncTransformInputs();
      return;
    }
    if (this.pendingLayerId !== layer.id || !this.pendingTransform) {
      this.pendingLayerId = layer.id;
      this.pendingTransform = createTransform(layer.transform);
      this.syncTransformInputs();
    }
  }

  updatePendingTransform(key, value) {
    this.ensurePendingTransform();
    if (!this.pendingTransform) return;
    if (key.startsWith('perspective')) value = Math.max(-0.95, Math.min(0.95, value));
    if (key.startsWith('scale')) value = Math.max(0.01, value);
    this.pendingTransform = createTransform({ ...this.pendingTransform, [key]: value });
    this.renderPreview();
  }

  applyTransform() {
    if (!this.pendingTransform || !this.pendingLayerId) return;
    this.execute(createSetTransformCommand(this.pendingLayerId, this.pendingTransform));
    this.pendingTransform = createTransform(this.documentModel.getLayer(this.pendingLayerId)?.transform);
    this.syncTransformInputs();
    this.renderOverlay();
  }

  cancelTransform(resetMode = true) {
    const hadPreview = Boolean(this.pendingTransform);
    this.pendingTransform = null;
    this.pendingLayerId = null;
    if (hadPreview) this.renderer.render(this.documentModel);
    if (resetMode && this.mode === 'transform') this.setMode('navigate');
    else this.renderOverlay();
  }

  renderPreview() {
    const layer = this.pendingLayerId ? this.documentModel.getLayer(this.pendingLayerId) : null;
    if (!layer || !this.pendingTransform) return;
    const original = layer.transform;
    layer.transform = this.pendingTransform;
    try { this.renderer.render(this.documentModel); } finally { layer.transform = original; }
    this.renderOverlay();
  }

  syncTransformInputs() {
    const transform = this.pendingTransform;
    for (const [key, input] of Object.entries(this.elements.transformInputs)) {
      if (!input) continue;
      input.disabled = !transform;
      input.value = transform ? String(roundValue(transform[key])) : '';
    }
    if (this.elements.transformApply) this.elements.transformApply.disabled = !transform;
    if (this.elements.transformCancel) this.elements.transformCancel.disabled = !transform;
  }

  resizeDocument() {
    const width = Number(this.elements.width?.value);
    const height = Number(this.elements.height?.value);
    this.execute(createResizeDocumentCommand(width, height, {
      interpolation: this.elements.interpolation?.value,
      scaleLayers: this.elements.scaleLayers?.checked
    }));
    this.fit();
  }

  resizeLayer() {
    const layer = this.documentModel.activeLayer;
    if (!layer || layer.type !== 'raster' || layer.locked) return;
    this.execute(createResizeLayerCommand(layer.id, Number(this.elements.width?.value), Number(this.elements.height?.value), {
      interpolation: this.elements.interpolation?.value
    }));
  }

  execute(command) {
    this.history.execute(command, this.documentModel);
    this.renderer.render(this.documentModel);
    this.refreshDocumentControls();
    this.renderOverlay();
  }

  refreshDocumentControls() {
    if (this.elements.width) this.elements.width.value = String(this.documentModel.width);
    if (this.elements.height) this.elements.height.value = String(this.documentModel.height);
    this.refreshPreferences();
    this.syncTransformInputs();
  }

  refreshPreferences() {
    const preferences = getCanvasMetadata(this.documentModel);
    if (this.elements.grid) this.elements.grid.checked = preferences.gridEnabled;
    if (this.elements.snap) this.elements.snap.checked = preferences.snapping;
    if (this.elements.guides) this.elements.guides.checked = preferences.guidesVisible;
  }

  activeLayerBounds(transformOverride = null) {
    const layer = this.documentModel.activeLayer;
    if (!layer) return null;
    const width = layer.type === 'text' ? Math.max(40, (layer.content.text?.length ?? 1) * layer.content.fontSize * 0.55) : layer.content?.width || this.documentModel.width;
    const height = layer.type === 'text' ? layer.content.fontSize * 1.3 : layer.content?.height || this.documentModel.height;
    return transformedBounds({ x: 0, y: 0, width, height }, transformOverride ?? layer.transform);
  }

  transformHitTest(point, bounds) {
    if (!bounds) return 'move';
    const threshold = 12 / this.viewport.zoom;
    const nearLeft = Math.abs(point.x - bounds.x) <= threshold;
    const nearRight = Math.abs(point.x - bounds.x - bounds.width) <= threshold;
    const nearTop = Math.abs(point.y - bounds.y) <= threshold;
    const nearBottom = Math.abs(point.y - bounds.y - bounds.height) <= threshold;
    const rotatePoint = { x: bounds.x + bounds.width / 2, y: bounds.y - 28 / this.viewport.zoom };
    if (Math.hypot(point.x - rotatePoint.x, point.y - rotatePoint.y) <= threshold * 1.4) return 'rotate';
    if (nearLeft && nearTop) return 'scale-left-top';
    if (nearRight && nearTop) return 'scale-right-top';
    if (nearLeft && nearBottom) return 'scale-left-bottom';
    if (nearRight && nearBottom) return 'scale-right-bottom';
    return 'move';
  }

  constrainCrop(rect) {
    const ratioValue = this.elements.cropRatio?.value ?? 'free';
    const ratio = ratioValue === 'original' ? this.documentModel.width / this.documentModel.height : ratioValue === 'free' ? 0 : Number(ratioValue);
    const normalized = normalizeRect(rect);
    if (ratio > 0 && normalized.width > 0 && normalized.height > 0) {
      if (normalized.width / normalized.height > ratio) normalized.width = normalized.height * ratio;
      else normalized.height = normalized.width / ratio;
    }
    normalized.x = Math.max(0, Math.min(normalized.x, this.documentModel.width - 1));
    normalized.y = Math.max(0, Math.min(normalized.y, this.documentModel.height - 1));
    normalized.width = Math.max(1, Math.min(normalized.width, this.documentModel.width - normalized.x));
    normalized.height = Math.max(1, Math.min(normalized.height, this.documentModel.height - normalized.y));
    return normalized;
  }

  eventDocumentPoint(event) {
    const rect = this.elements.stage.getBoundingClientRect();
    return screenToDocument({ x: event.clientX - rect.left, y: event.clientY - rect.top }, this.viewport);
  }

  renderOverlay() {
    const overlay = this.elements.overlay;
    if (!overlay?.getContext) return;
    if (overlay.width !== this.documentModel.width) overlay.width = this.documentModel.width;
    if (overlay.height !== this.documentModel.height) overlay.height = this.documentModel.height;
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);
    const preferences = getCanvasMetadata(this.documentModel);
    const lineWidth = Math.max(0.25, 1 / this.viewport.zoom);

    if (preferences.gridEnabled) {
      context.save();
      context.strokeStyle = 'rgba(255,255,255,.14)';
      context.lineWidth = lineWidth;
      context.beginPath();
      for (let x = preferences.gridSize; x < overlay.width; x += preferences.gridSize) { context.moveTo(x, 0); context.lineTo(x, overlay.height); }
      for (let y = preferences.gridSize; y < overlay.height; y += preferences.gridSize) { context.moveTo(0, y); context.lineTo(overlay.width, y); }
      context.stroke();
      context.restore();
    }

    if (preferences.guidesVisible) {
      context.save();
      context.strokeStyle = '#42a5ff';
      context.lineWidth = lineWidth;
      context.beginPath();
      for (const x of preferences.guides.vertical) { context.moveTo(x, 0); context.lineTo(x, overlay.height); }
      for (const y of preferences.guides.horizontal) { context.moveTo(0, y); context.lineTo(overlay.width, y); }
      context.stroke();
      context.restore();
    }

    if (this.mode === 'crop' && this.cropRect) this.drawCrop(context, this.cropRect);
    if (this.mode === 'transform') this.drawTransformBounds(context);
    this.drawRulers();
  }

  drawCrop(context, rectInput) {
    const rect = normalizeRect(rectInput);
    context.save();
    context.fillStyle = 'rgba(0,0,0,.58)';
    context.beginPath();
    context.rect(0, 0, this.documentModel.width, this.documentModel.height);
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fill('evenodd');
    context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.rotate(this.cropAngle * Math.PI / 180);
    context.strokeStyle = '#fff';
    context.lineWidth = Math.max(0.5, 2 / this.viewport.zoom);
    context.setLineDash([8 / this.viewport.zoom, 5 / this.viewport.zoom]);
    context.strokeRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
    context.setLineDash([]);
    context.strokeStyle = 'rgba(255,255,255,.6)';
    context.lineWidth = Math.max(0.25, 1 / this.viewport.zoom);
    for (const fraction of [1 / 3, 2 / 3]) {
      context.beginPath(); context.moveTo(-rect.width / 2 + rect.width * fraction, -rect.height / 2); context.lineTo(-rect.width / 2 + rect.width * fraction, rect.height / 2); context.stroke();
      context.beginPath(); context.moveTo(-rect.width / 2, -rect.height / 2 + rect.height * fraction); context.lineTo(rect.width / 2, -rect.height / 2 + rect.height * fraction); context.stroke();
    }
    context.restore();
  }

  drawTransformBounds(context) {
    this.ensurePendingTransform();
    const bounds = this.activeLayerBounds(this.pendingTransform);
    if (!bounds) return;
    context.save();
    context.strokeStyle = '#31c48d';
    context.fillStyle = '#181818';
    context.lineWidth = Math.max(0.5, 2 / this.viewport.zoom);
    context.beginPath();
    bounds.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.stroke();
    const radius = 5 / this.viewport.zoom;
    for (const point of bounds.points) { context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.stroke(); }
    const rotate = { x: bounds.x + bounds.width / 2, y: bounds.y - 28 / this.viewport.zoom };
    context.beginPath(); context.moveTo(bounds.x + bounds.width / 2, bounds.y); context.lineTo(rotate.x, rotate.y); context.stroke();
    context.beginPath(); context.arc(rotate.x, rotate.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.restore();
  }

  resizeRulers() {
    const stage = this.elements.stage;
    const dpr = globalThis.devicePixelRatio || 1;
    if (!stage) return;
    for (const [canvas, width, height] of [[this.elements.rulerX, stage.clientWidth, 20], [this.elements.rulerY, 20, stage.clientHeight]]) {
      if (!canvas) continue;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    }
  }

  drawRulers() {
    const preferences = getCanvasMetadata(this.documentModel);
    const draw = (canvas, axis) => {
      if (!canvas?.getContext) return;
      canvas.hidden = !preferences.rulersVisible;
      if (canvas.hidden) return;
      const context = canvas.getContext('2d');
      const dpr = globalThis.devicePixelRatio || 1;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#202020'; context.fillRect(0, 0, width, height);
      context.strokeStyle = '#555'; context.fillStyle = '#aaa'; context.font = '9px sans-serif'; context.lineWidth = 1;
      const screenStart = axis === 'x' ? 0 : 0;
      const screenEnd = axis === 'x' ? width : height;
      const documentStart = axis === 'x' ? screenToDocument({ x: screenStart, y: 0 }, this.viewport).x : screenToDocument({ x: 0, y: screenStart }, this.viewport).y;
      const documentEnd = axis === 'x' ? screenToDocument({ x: screenEnd, y: 0 }, this.viewport).x : screenToDocument({ x: 0, y: screenEnd }, this.viewport).y;
      const step = niceStep(60 / this.viewport.zoom);
      const first = Math.floor(documentStart / step) * step;
      for (let value = first; value <= documentEnd + step; value += step) {
        const screen = axis === 'x' ? documentToScreen({ x: value, y: 0 }, this.viewport).x : documentToScreen({ x: 0, y: value }, this.viewport).y;
        context.beginPath();
        if (axis === 'x') { context.moveTo(screen + .5, height); context.lineTo(screen + .5, 9); context.fillText(String(Math.round(value)), screen + 3, 9); }
        else { context.moveTo(width, screen + .5); context.lineTo(9, screen + .5); context.save(); context.translate(9, screen - 3); context.rotate(-Math.PI / 2); context.fillText(String(Math.round(value)), 0, 0); context.restore(); }
        context.stroke();
      }
    };
    draw(this.elements.rulerX, 'x');
    draw(this.elements.rulerY, 'y');
  }

  addGuideFromRuler(axis, event) {
    event.preventDefault();
    const rect = this.elements.stage.getBoundingClientRect();
    const point = screenToDocument({ x: event.clientX - rect.left, y: event.clientY - rect.top }, this.viewport);
    this.execute(createAddGuideCommand(axis, axis === 'vertical' ? point.x : point.y));
  }

  removeGuideFromRuler(axis, event) {
    event.preventDefault();
    const preferences = getCanvasMetadata(this.documentModel);
    const rect = this.elements.stage.getBoundingClientRect();
    const point = screenToDocument({ x: event.clientX - rect.left, y: event.clientY - rect.top }, this.viewport);
    const value = axis === 'vertical' ? point.x : point.y;
    const values = preferences.guides[axis] ?? [];
    const nearest = values.reduce((best, current) => best === null || Math.abs(current - value) < Math.abs(best - value) ? current : best, null);
    if (nearest !== null && Math.abs(nearest - value) <= 12 / this.viewport.zoom) this.execute(createRemoveGuideCommand(axis, nearest));
  }

  handleKeyDown(event) {
    if (isEditable(event.target)) return;
    if (event.code === 'Space') { this.spacePressed = true; event.preventDefault(); return; }
    const key = event.key.toLowerCase();
    if (key === '+' || key === '=') { event.preventDefault(); this.stepZoom(1); }
    else if (key === '-') { event.preventDefault(); this.stepZoom(-1); }
    else if (key === '0') { event.preventDefault(); this.fit(); }
    else if (key === '1') { event.preventDefault(); this.setZoom(1); }
    else if (key === 'h') this.setMode('hand');
    else if (key === 'c') this.setMode('crop');
    else if (key === 'v') this.setMode('transform');
    else if (key === 'escape') { if (this.mode === 'crop') this.cancelCrop(); else if (this.mode === 'transform') this.cancelTransform(); else this.setMode('navigate'); }
    else if (key === 'enter') { if (this.mode === 'crop') this.applyCrop(); else if (this.mode === 'transform') this.applyTransform(); }
  }

  handleKeyUp(event) { if (event.code === 'Space') this.spacePressed = false; }

  schedulePersistViewport() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.documentModel.metadata = { ...this.documentModel.metadata, viewport: { ...this.viewport } };
      this.documentModel.touch();
      this.documentModel.emit('viewport:change', { viewport: { ...this.viewport } });
    }, 250);
  }
}

function niceStep(minimum) {
  const power = 10 ** Math.floor(Math.log10(Math.max(1e-6, minimum)));
  for (const multiplier of [1, 2, 5, 10]) if (multiplier * power >= minimum) return multiplier * power;
  return 10 * power;
}
function roundValue(value) { return Math.round((Number(value) || 0) * 1000) / 1000; }
function isEditable(target) { return target?.matches?.('input, textarea, select, [contenteditable="true"]'); }
