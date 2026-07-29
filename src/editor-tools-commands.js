import { createShapeLayer, createTextLayer } from './editor-document.js';
import { addLayerCommand, createDocumentCommand } from './editor-history.js';
import { contractSelection, createSelection, expandSelection, featherSelection, invertSelection } from './editor-selection.js';

export function getDocumentSelection(documentModel) {
  const saved = documentModel.metadata?.selection;
  return saved ? createSelection(saved) : createSelection({ width: documentModel.width, height: documentModel.height });
}

export function createSetSelectionCommand(selectionInput, label = 'Zmień zaznaczenie') {
  const selection = createSelection(selectionInput);
  return createDocumentCommand(label, documentModel => {
    documentModel.metadata = { ...documentModel.metadata, selection };
    documentModel.touch();
    documentModel.emit('selection-area:change', { selection });
  });
}

export function createClearSelectionCommand() {
  return createDocumentCommand('Wyczyść zaznaczenie', documentModel => {
    documentModel.metadata = { ...documentModel.metadata, selection: null };
    documentModel.touch();
    documentModel.emit('selection-area:change', { selection: null });
  });
}

export function createFeatherSelectionCommand(documentModel, radius) {
  return createSetSelectionCommand(featherSelection(getDocumentSelection(documentModel), radius), 'Wygładź krawędź zaznaczenia');
}
export function createExpandSelectionCommand(documentModel, radius) {
  return createSetSelectionCommand(expandSelection(getDocumentSelection(documentModel), radius), 'Rozszerz zaznaczenie');
}
export function createContractSelectionCommand(documentModel, radius) {
  return createSetSelectionCommand(contractSelection(getDocumentSelection(documentModel), radius), 'Zmniejsz zaznaczenie');
}
export function createInvertSelectionCommand(documentModel) {
  return createSetSelectionCommand(invertSelection(getDocumentSelection(documentModel)), 'Odwróć zaznaczenie');
}

export function createTextLayerCommand(point, options = {}) {
  const layer = createTextLayer({
    name: options.name ?? 'Tekst',
    text: options.text ?? 'Tekst',
    fontFamily: options.fontFamily ?? 'sans-serif',
    fontSize: options.fontSize ?? 32,
    fontWeight: options.fontWeight ?? '400',
    color: options.color ?? '#ffffff',
    align: options.align ?? 'left',
    maxWidth: options.maxWidth ?? 0,
    transform: { x: Number(point?.x) || 0, y: Number(point?.y) || 0 }
  });
  return addLayerCommand(layer);
}

export function createShapeLayerCommand(rect, options = {}) {
  const raw = { x: Number(rect?.x) || 0, y: Number(rect?.y) || 0, width: Number(rect?.width) || 0, height: Number(rect?.height) || 0 };
  const normalized = normalizeRect(raw);
  const kind = options.shape ?? 'rectangle';
  const directional = kind === 'line' || kind === 'arrow';
  const shape = createShapeLayer({
    name: options.name ?? 'Kształt',
    shape: kind,
    width: Math.max(1, normalized.width),
    height: Math.max(1, normalized.height),
    fill: options.fill ?? '#31c48d',
    stroke: options.stroke ?? '#ffffff',
    strokeWidth: options.strokeWidth ?? 0,
    radius: options.radius ?? 0,
    shadowColor: options.shadowColor ?? 'rgba(0,0,0,.35)',
    shadowBlur: options.shadowBlur ?? 0,
    shadowOffsetX: options.shadowOffsetX ?? 0,
    shadowOffsetY: options.shadowOffsetY ?? 0,
    transform: directional
      ? { x: raw.x, y: raw.y, scaleX: raw.width < 0 ? -1 : 1, scaleY: raw.height < 0 ? -1 : 1 }
      : { x: normalized.x, y: normalized.y }
  });
  return addLayerCommand(shape);
}

function normalizeRect(rect = {}) {
  const x1 = Number(rect.x) || 0;
  const y1 = Number(rect.y) || 0;
  const x2 = x1 + (Number(rect.width) || 0);
  const y2 = y1 + (Number(rect.height) || 0);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
