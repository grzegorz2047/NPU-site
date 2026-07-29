import { combineSelection, createSelection, ellipseSelection, magicWandSelection, polygonSelection, rasterizeSelection, rectangleSelection, selectionBounds } from './editor-selection.js';
import { createAppendEraseStrokeCommand, createGradientFill, createPaintOperationCommand, createSolidFill } from './editor-paint.js';
import { createClearSelectionCommand, createContractSelectionCommand, createExpandSelectionCommand, createFeatherSelectionCommand, createInvertSelectionCommand, createSetSelectionCommand, createShapeLayerCommand, createTextLayerCommand, getDocumentSelection } from './editor-tools-commands.js';
import { ensureToolsUi } from './editor-tools-ui.js';

const TOOL_NAMES = Object.freeze({ none: 'Brak aktywnego narzędzia', select: 'Zaznaczenie', brush: 'Pędzel', eraser: 'Gumka maskująca', fill: 'Wiadro', gradient: 'Gradient', eyedropper: 'Pipeta', text: 'Tekst', shape: 'Kształt' });
const TOOL_SHORTCUTS = Object.freeze({ m: 'select', b: 'brush', e: 'eraser', f: 'fill', g: 'gradient', i: 'eyedropper', t: 'text', u: 'shape', w: 'select' });

export class ToolsController {
  constructor({ documentModel, history, renderer, canvasController, root = document } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.canvasController = canvasController;
    this.root = root;
    ensureToolsUi(root);
    this.elements = this.resolveElements();
    this.tool = 'none';
    this.session = null;
    this.polygonPoints = [];
    this.preview = null;
    this.boundaryCache = null;
    this.unsubscribe = documentModel.subscribe(event => this.handleDocumentEvent(event));
    this.bind();
    this.syncOutputs();
    this.resizeOverlay();
    this.renderOverlay();
  }

  destroy() { this.unsubscribe?.(); }

  resolveElements() {
    const get = id => this.root.getElementById?.(id) ?? null;
    return {
      overlay: get('manual-tools-overlay'), toolName: get('manual-tool-name'), close: get('manual-tool-close'),
      buttons: [...(this.root.querySelectorAll?.('[data-manual-tool]') ?? [])], optionGroups: [...(this.root.querySelectorAll?.('[data-tool-options]') ?? [])],
      selectionKind: get('selection-kind'), selectionOperation: get('selection-operation'), wandTolerance: get('wand-tolerance'), wandContiguous: get('wand-contiguous'), wandAntialias: get('wand-antialias'), selectionRadius: get('selection-radius'), selectionFeather: get('selection-feather'), selectionExpand: get('selection-expand'), selectionContract: get('selection-contract'), selectionInvert: get('selection-invert'), selectionClear: get('selection-clear'), selectionStatus: get('selection-status'),
      brushSize: get('brush-size'), brushSizeOutput: get('brush-size-output'), brushHardness: get('brush-hardness'), brushHardnessOutput: get('brush-hardness-output'), brushOpacity: get('brush-opacity'), brushOpacityOutput: get('brush-opacity-output'), brushSpacing: get('brush-spacing'), brushSpacingOutput: get('brush-spacing-output'), toolColorA: get('tool-color-a'), brushColorLabel: this.root.querySelector?.('[data-brush-color]'),
      fillColorA: get('fill-color-a'), fillColorB: get('fill-color-b'), fillOpacity: get('fill-opacity'), fillOpacityOutput: get('fill-opacity-output'), fillTolerance: get('fill-tolerance'), fillToleranceOutput: get('fill-tolerance-output'), fillToleranceLabel: this.root.querySelector?.('[data-fill-tolerance]'), gradientType: get('gradient-type'), gradientTypeLabel: this.root.querySelector?.('[data-gradient-type]'), sampledColorStatus: get('sampled-color-status'),
      textContent: get('text-content'), textFont: get('text-font'), textSize: get('text-size'), textColor: get('text-color'), textWeight: get('text-weight'), textAlign: get('text-align'),
      shapeKind: get('shape-kind'), shapeFill: get('shape-fill'), shapeStroke: get('shape-stroke'), shapeStrokeWidth: get('shape-stroke-width'), shapeRadius: get('shape-radius'), shapeShadowBlur: get('shape-shadow-blur'), shapeShadowColor: get('shape-shadow-color'), shapeShadowX: get('shape-shadow-x'), shapeShadowY: get('shape-shadow-y')
    };
  }

  bind() {
    const e = this.elements;
    for (const button of e.buttons) button.addEventListener('click', () => this.setTool(this.tool === button.dataset.manualTool ? 'none' : button.dataset.manualTool));
    e.close?.addEventListener('click', () => this.setTool('none'));
    for (const element of [e.brushSize, e.brushHardness, e.brushOpacity, e.brushSpacing, e.fillOpacity, e.fillTolerance]) element?.addEventListener('input', () => this.syncOutputs());
    e.selectionKind?.addEventListener('change', () => { this.cancelSession(); if (e.selectionKind.value === 'wand') this.setTool('select'); });
    e.selectionFeather?.addEventListener('click', () => this.adjustSelection('feather'));
    e.selectionExpand?.addEventListener('click', () => this.adjustSelection('expand'));
    e.selectionContract?.addEventListener('click', () => this.adjustSelection('contract'));
    e.selectionInvert?.addEventListener('click', () => this.adjustSelection('invert'));
    e.selectionClear?.addEventListener('click', () => this.execute(createClearSelectionCommand()));
    e.overlay?.addEventListener('pointerdown', event => this.handlePointerDown(event));
    e.overlay?.addEventListener('pointermove', event => this.handlePointerMove(event));
    e.overlay?.addEventListener('pointerup', event => this.handlePointerUp(event));
    e.overlay?.addEventListener('pointercancel', () => this.cancelSession());
    e.overlay?.addEventListener('dblclick', event => this.handleDoubleClick(event));
    this.root.addEventListener?.('keydown', event => this.handleKeyDown(event));
    for (const id of ['hand-tool', 'crop-tool', 'transform-tool']) getById(this.root, id)?.addEventListener('click', () => this.setTool('none'));
  }

  setTool(tool) {
    if (!TOOL_NAMES[tool]) tool = 'none';
    this.cancelSession();
    this.tool = tool;
    if (tool !== 'none') this.canvasController?.setMode?.('navigate');
    for (const button of this.elements.buttons) button.classList.toggle('active', button.dataset.manualTool === tool);
    for (const group of this.elements.optionGroups) group.hidden = !String(group.dataset.toolOptions || '').split(/\s+/).includes(tool);
    if (this.elements.toolName) this.elements.toolName.textContent = TOOL_NAMES[tool];
    if (this.elements.overlay) {
      this.elements.overlay.dataset.active = String(tool !== 'none');
      this.elements.overlay.style.cursor = cursorForTool(tool);
      if (tool !== 'none') this.elements.overlay.focus({ preventScroll: true });
    }
    if (this.elements.brushColorLabel) this.elements.brushColorLabel.hidden = tool === 'eraser';
    if (this.elements.gradientTypeLabel) this.elements.gradientTypeLabel.hidden = tool !== 'gradient';
    if (this.elements.fillToleranceLabel) this.elements.fillToleranceLabel.hidden = tool !== 'fill';
    this.renderOverlay();
  }

  handleDocumentEvent(event) {
    if (event.type === 'document:restore' || event.type === 'document:crop' || event.type === 'document:resize') { this.cancelSession(); this.resizeOverlay(); }
    if (event.type.startsWith('selection-area') || event.type === 'document:restore') {
      this.boundaryCache = null;
      if (event.type.startsWith('selection-area')) this.root.dispatchEvent?.(new CustomEvent('localstudio:selection-change'));
    }
    this.updateSelectionStatus();
    this.renderOverlay();
  }

  handlePointerDown(event) {
    if (event.button !== 0 || this.tool === 'none') return;
    event.preventDefault(); event.stopPropagation();
    const point = this.point(event);
    this.elements.overlay?.setPointerCapture?.(event.pointerId);
    if (this.tool === 'select') return this.startSelection(point);
    if (this.tool === 'brush' || this.tool === 'eraser') { this.session = { type: this.tool, points: [pressurePoint(point, event)] }; this.preview = { type: this.tool, points: this.session.points }; this.renderOverlay(); return; }
    if (this.tool === 'gradient') { this.session = { type: 'gradient', start: point, end: point }; this.preview = this.session; this.renderOverlay(); return; }
    if (this.tool === 'shape') { this.session = { type: 'shape', start: point, end: point }; this.preview = this.session; this.renderOverlay(); return; }
    if (this.tool === 'fill') return this.applyFill(point);
    if (this.tool === 'eyedropper') return this.sampleColor(point);
    if (this.tool === 'text') return this.addText(point);
  }

  handlePointerMove(event) {
    if (!this.session) return;
    const point = this.point(event);
    if (this.session.type === 'brush' || this.session.type === 'eraser') {
      const next = pressurePoint(point, event), previous = this.session.points.at(-1);
      if (Math.hypot(next.x - previous.x, next.y - previous.y) >= 0.35) this.session.points.push(next);
      this.preview = { type: this.session.type, points: this.session.points };
    } else if (['gradient', 'shape', 'selection-rect', 'selection-ellipse'].includes(this.session.type)) { this.session.end = point; this.preview = this.session; }
    else if (this.session.type === 'selection-freehand') { const previous = this.session.points.at(-1); if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 1) this.session.points.push(point); this.preview = this.session; }
    this.renderOverlay();
  }

  handlePointerUp() {
    if (!this.session) return;
    const session = this.session; this.session = null; this.preview = null;
    if (session.type === 'brush') this.commitBrush(session.points);
    else if (session.type === 'eraser') this.commitEraser(session.points);
    else if (session.type === 'gradient') this.commitGradient(session.start, session.end);
    else if (session.type === 'shape') this.commitShape(session.start, session.end);
    else if (session.type === 'selection-rect') this.commitSelection(rectangleSelection(rectFromPoints(session.start, session.end)));
    else if (session.type === 'selection-ellipse') this.commitSelection(ellipseSelection(rectFromPoints(session.start, session.end)));
    else if (session.type === 'selection-freehand' && session.points.length >= 3) this.commitSelection(polygonSelection(session.points, 'freehand'));
    this.renderOverlay();
  }

  handleDoubleClick(event) {
    if (this.tool !== 'select' || this.elements.selectionKind?.value !== 'polygon' || this.polygonPoints.length < 3) return;
    event.preventDefault(); event.stopPropagation();
    this.commitSelection(polygonSelection(this.polygonPoints, 'polygon'));
    this.polygonPoints = []; this.preview = null; this.renderOverlay();
  }

  startSelection(point) {
    const kind = this.elements.selectionKind?.value ?? 'rectangle';
    if (kind === 'wand') return this.magicWand(point);
    if (kind === 'polygon') { this.polygonPoints.push(point); this.preview = { type: 'selection-polygon', points: this.polygonPoints }; this.renderOverlay(); return; }
    if (kind === 'freehand') { this.session = { type: 'selection-freehand', points: [point] }; this.preview = this.session; return; }
    this.session = { type: kind === 'ellipse' ? 'selection-ellipse' : 'selection-rect', start: point, end: point };
    this.preview = this.session;
  }

  magicWand(point) {
    try {
      this.renderer.render(this.documentModel);
      const imageData = this.renderer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.documentModel.width, this.documentModel.height);
      const shape = magicWandSelection(imageData, this.documentModel.width, this.documentModel.height, point, Number(this.elements.wandTolerance?.value) || 0, { contiguous: this.elements.wandContiguous?.checked, antiAlias: this.elements.wandAntialias?.checked });
      this.commitSelection(shape, 'Magic wand');
    } catch (error) { this.setStatus(`Magic wand: ${error.message}`); }
  }

  commitSelection(shape, label = 'Zmień zaznaczenie') {
    const current = getDocumentSelection(this.documentModel);
    const operation = current.entries.length || current.inverted ? (this.elements.selectionOperation?.value ?? 'replace') : 'replace';
    this.execute(createSetSelectionCommand(combineSelection(current, shape, operation), label));
  }

  adjustSelection(action) {
    const selection = getDocumentSelection(this.documentModel);
    if (!selection.entries.length && !selection.inverted) return;
    const radius = Math.max(1, Number(this.elements.selectionRadius?.value) || 1);
    if (action === 'feather') this.execute(createFeatherSelectionCommand(this.documentModel, radius));
    else if (action === 'expand') this.execute(createExpandSelectionCommand(this.documentModel, radius));
    else if (action === 'contract') this.execute(createContractSelectionCommand(this.documentModel, radius));
    else if (action === 'invert') this.execute(createInvertSelectionCommand(this.documentModel));
  }

  commitBrush(points) {
    if (!points.length) return;
    this.execute(createPaintOperationCommand(this.documentModel, { points, ...this.brushOptions(), selection: this.selectionSnapshot() }));
  }

  commitEraser(points) {
    const layer = this.documentModel.activeLayer;
    if (!layer || layer.locked) return this.setStatus('Wybierz odblokowaną warstwę do wymazania.');
    this.execute(createAppendEraseStrokeCommand(layer.id, { points, ...this.brushOptions(), selection: this.selectionSnapshot() }));
  }

  applyFill(point) {
    try {
      this.renderer.render(this.documentModel);
      const imageData = this.renderer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.documentModel.width, this.documentModel.height);
      const bucketShape = magicWandSelection(imageData, this.documentModel.width, this.documentModel.height, point, Number(this.elements.fillTolerance?.value) || 0, { contiguous: true, antiAlias: true });
      const activeSelection = getDocumentSelection(this.documentModel);
      const bucketSelection = activeSelection.entries.length || activeSelection.inverted ? combineSelection(activeSelection, bucketShape, 'intersect') : combineSelection(createSelection({ width: this.documentModel.width, height: this.documentModel.height }), bucketShape, 'replace');
      this.execute(createPaintOperationCommand(this.documentModel, createSolidFill({ color: this.elements.fillColorA?.value, opacity: this.fillOpacity(), selection: bucketSelection })));
    } catch (error) { this.setStatus(`Wiadro: ${error.message}`); }
  }

  commitGradient(start, end) {
    this.execute(createPaintOperationCommand(this.documentModel, createGradientFill(start, end, { type: this.elements.gradientType?.value, colorA: this.elements.fillColorA?.value, colorB: this.elements.fillColorB?.value, opacity: this.fillOpacity(), selection: this.selectionSnapshot() })));
  }

  sampleColor(point) {
    try {
      this.renderer.render(this.documentModel);
      const pixel = this.renderer.canvas.getContext('2d', { willReadFrequently: true }).getImageData(clamp(Math.floor(point.x), 0, this.documentModel.width - 1), clamp(Math.floor(point.y), 0, this.documentModel.height - 1), 1, 1).data;
      const color = rgbToHex(pixel[0], pixel[1], pixel[2]);
      for (const input of [this.elements.toolColorA, this.elements.fillColorA, this.elements.textColor, this.elements.shapeFill]) if (input) input.value = color;
      if (this.elements.sampledColorStatus) this.elements.sampledColorStatus.textContent = `Pobrano ${color.toUpperCase()} · alpha ${Math.round(pixel[3] / 255 * 100)}%`;
    } catch (error) { this.setStatus(`Pipeta: ${error.message}`); }
  }

  addText(point) {
    const text = this.elements.textContent?.value?.trim() || 'Tekst';
    this.execute(createTextLayerCommand(point, { text, fontFamily: this.elements.textFont?.value, fontSize: Number(this.elements.textSize?.value), fontWeight: this.elements.textWeight?.value, color: this.elements.textColor?.value, align: this.elements.textAlign?.value }));
  }

  commitShape(start, end) {
    const rect = { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
    if (Math.abs(rect.width) < 1 && Math.abs(rect.height) < 1) return;
    this.execute(createShapeLayerCommand(rect, { shape: this.elements.shapeKind?.value, fill: ['line', 'arrow'].includes(this.elements.shapeKind?.value) ? null : this.elements.shapeFill?.value, stroke: this.elements.shapeStroke?.value, strokeWidth: Number(this.elements.shapeStrokeWidth?.value), radius: Number(this.elements.shapeRadius?.value), shadowColor: this.elements.shapeShadowColor?.value, shadowBlur: Number(this.elements.shapeShadowBlur?.value), shadowOffsetX: Number(this.elements.shapeShadowX?.value), shadowOffsetY: Number(this.elements.shapeShadowY?.value) }));
  }

  brushOptions() { return { size: Number(this.elements.brushSize?.value), hardness: Number(this.elements.brushHardness?.value) / 100, opacity: Number(this.elements.brushOpacity?.value) / 100, spacing: Number(this.elements.brushSpacing?.value) / 100, color: this.elements.toolColorA?.value }; }
  fillOpacity() { return Number(this.elements.fillOpacity?.value) / 100; }
  selectionSnapshot() { const selection = getDocumentSelection(this.documentModel); return selection.entries.length || selection.inverted ? selection : null; }

  execute(command) {
    this.history.execute(command, this.documentModel);
    this.renderer.render(this.documentModel);
    this.boundaryCache = null;
    this.updateSelectionStatus();
    this.renderOverlay();
  }

  handleKeyDown(event) {
    if (isEditable(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') { if (this.session || this.polygonPoints.length) this.cancelSession(); else this.setTool('none'); return; }
    const tool = TOOL_SHORTCUTS[key];
    if (!tool) return;
    event.preventDefault();
    if (key === 'w' && this.elements.selectionKind) this.elements.selectionKind.value = 'wand';
    this.setTool(tool);
  }

  cancelSession() { this.session = null; this.polygonPoints = []; this.preview = null; this.renderOverlay(); }
  point(event) { const point = this.canvasController?.eventDocumentPoint?.(event) ?? { x: event.offsetX, y: event.offsetY }; return { x: clamp(point.x, 0, this.documentModel.width), y: clamp(point.y, 0, this.documentModel.height) }; }
  resizeOverlay() { const overlay = this.elements.overlay; if (!overlay) return; if (overlay.width !== this.documentModel.width) overlay.width = this.documentModel.width; if (overlay.height !== this.documentModel.height) overlay.height = this.documentModel.height; }
  renderOverlay() { const overlay = this.elements.overlay; if (!overlay?.getContext) return; this.resizeOverlay(); const context = overlay.getContext('2d'); context.clearRect(0, 0, overlay.width, overlay.height); this.drawSelection(context); this.drawPreview(context); }

  drawSelection(context) {
    const selection = getDocumentSelection(this.documentModel);
    if (!selection.entries.length && !selection.inverted) return;
    const cacheKey = `${this.documentModel.width}x${this.documentModel.height}:${JSON.stringify(selection)}`;
    if (this.boundaryCache?.key !== cacheKey) this.boundaryCache = { key: cacheKey, points: boundaryPoints(rasterizeSelection(selection, this.documentModel.width, this.documentModel.height), this.documentModel.width, this.documentModel.height) };
    context.save(); context.fillStyle = 'rgba(255,255,255,.95)';
    const size = Math.max(0.6, 1.4 / (this.canvasController?.viewport?.zoom || 1));
    for (let index = 0; index < this.boundaryCache.points.length; index += 2) { const point = this.boundaryCache.points[index]; context.fillRect(point.x, point.y, size, size); }
    context.fillStyle = 'rgba(0,0,0,.9)';
    for (let index = 1; index < this.boundaryCache.points.length; index += 2) { const point = this.boundaryCache.points[index]; context.fillRect(point.x, point.y, size, size); }
    context.restore();
  }

  drawPreview(context) {
    const preview = this.preview;
    if (!preview) return;
    context.save();
    context.lineWidth = Math.max(0.5, 2 / (this.canvasController?.viewport?.zoom || 1));
    context.strokeStyle = '#63a7ff'; context.fillStyle = 'rgba(99,167,255,.12)';
    context.setLineDash([6 / (this.canvasController?.viewport?.zoom || 1), 4 / (this.canvasController?.viewport?.zoom || 1)]);
    if (preview.type === 'selection-rect' || preview.type === 'selection-ellipse' || preview.type === 'shape') {
      const rect = rectFromPoints(preview.start, preview.end);
      if (preview.type === 'selection-ellipse' || (preview.type === 'shape' && this.elements.shapeKind?.value === 'ellipse')) { context.beginPath(); context.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2); context.fill(); context.stroke(); }
      else { context.fillRect(rect.x, rect.y, rect.width, rect.height); context.strokeRect(rect.x, rect.y, rect.width, rect.height); }
    } else if (preview.type === 'selection-freehand' || preview.type === 'selection-polygon') drawPolyline(context, preview.points, preview.type === 'selection-polygon' && preview.points.length >= 3);
    else if (preview.type === 'brush' || preview.type === 'eraser') { context.setLineDash([]); context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = preview.type === 'eraser' ? 'rgba(255,120,130,.85)' : this.elements.toolColorA?.value || '#111'; context.globalAlpha = Number(this.elements.brushOpacity?.value) / 100; context.lineWidth = Number(this.elements.brushSize?.value) || 24; drawPolyline(context, preview.points, false); }
    else if (preview.type === 'gradient') { context.setLineDash([]); context.beginPath(); context.moveTo(preview.start.x, preview.start.y); context.lineTo(preview.end.x, preview.end.y); context.stroke(); const radius = 4 / (this.canvasController?.viewport?.zoom || 1); for (const point of [preview.start, preview.end]) { context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); } }
    context.restore();
  }

  syncOutputs() {
    const e = this.elements;
    if (e.brushSizeOutput) e.brushSizeOutput.textContent = `${e.brushSize?.value ?? 24} px`;
    if (e.brushHardnessOutput) e.brushHardnessOutput.textContent = `${e.brushHardness?.value ?? 70}%`;
    if (e.brushOpacityOutput) e.brushOpacityOutput.textContent = `${e.brushOpacity?.value ?? 100}%`;
    if (e.brushSpacingOutput) e.brushSpacingOutput.textContent = `${e.brushSpacing?.value ?? 20}%`;
    if (e.fillOpacityOutput) e.fillOpacityOutput.textContent = `${e.fillOpacity?.value ?? 100}%`;
    if (e.fillToleranceOutput) e.fillToleranceOutput.textContent = String(e.fillTolerance?.value ?? 24);
    this.updateSelectionStatus();
  }

  updateSelectionStatus() {
    if (!this.elements.selectionStatus) return;
    const selection = getDocumentSelection(this.documentModel), bounds = selectionBounds(selection);
    this.elements.selectionStatus.textContent = bounds ? `Zaznaczenie: ${bounds.width}×${bounds.height} px · ${selection.entries.length} operacji${selection.inverted ? ' · odwrócone' : ''}` : 'Brak zaznaczenia — operacje obejmują cały dokument.';
  }

  setStatus(message) { if (this.elements.selectionStatus && this.tool === 'select') this.elements.selectionStatus.textContent = message; else if (this.elements.sampledColorStatus) this.elements.sampledColorStatus.textContent = message; }
}

function boundaryPoints(mask, width, height) {
  const points = [], selected = index => index >= 0 && index < mask.length && mask[index] >= 128;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const index = y * width + x; if (!selected(index)) continue; if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !selected(index - 1) || !selected(index + 1) || !selected(index - width) || !selected(index + width)) points.push({ x, y }); }
  return points;
}
function drawPolyline(context, points, close) { if (!points?.length) return; context.beginPath(); context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); if (close) context.closePath(); context.stroke(); }
function pressurePoint(point, event) { return { ...point, pressure: event.pressure > 0 ? event.pressure : 1 }; }
function rectFromPoints(start, end) { return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; }
function rgbToHex(red, green, blue) { return `#${[red, green, blue].map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`; }
function cursorForTool(tool) { return tool === 'eyedropper' ? 'copy' : tool === 'text' ? 'text' : tool === 'fill' ? 'cell' : 'crosshair'; }
function isEditable(target) { return target?.matches?.('input, textarea, select, [contenteditable="true"]'); }
function getById(root, id) { return root.getElementById?.(id) ?? null; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
