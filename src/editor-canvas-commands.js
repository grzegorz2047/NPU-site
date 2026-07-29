import { createTransform } from './editor-document.js';
import { createDocumentCommand, updateLayerCommand } from './editor-history.js';
import { constrainCropRect } from './editor-canvas-geometry.js';

export function createCropDocumentCommand(rectInput, options = {}) {
  const rect = constrainCropRect(rectInput, options.aspectRatio, options.bounds);
  const angle = finite(options.angle, 0);
  if (rect.width < 1 || rect.height < 1) throw new Error('Obszar kadrowania jest zbyt mały.');
  return createDocumentCommand('Kadruj dokument', documentModel => {
    const crop = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      angle
    };
    for (const layer of documentModel.layers) {
      layer.transform = createTransform({
        ...layer.transform,
        x: layer.transform.x - crop.x,
        y: layer.transform.y - crop.y,
        rotation: layer.transform.rotation - angle,
        originX: angle ? crop.width / 2 : layer.transform.originX,
        originY: angle ? crop.height / 2 : layer.transform.originY
      });
    }
    documentModel.width = crop.width;
    documentModel.height = crop.height;
    documentModel.metadata = {
      ...documentModel.metadata,
      lastCrop: crop,
      cropHistory: [...(documentModel.metadata?.cropHistory ?? []), crop].slice(-20),
      canvasGeometryLocked: true
    };
    documentModel.touch();
    documentModel.emit('document:crop', { crop });
  });
}

export function createResizeDocumentCommand(widthInput, heightInput, options = {}) {
  const width = dimension(widthInput);
  const height = dimension(heightInput);
  const interpolation = normalizeInterpolation(options.interpolation);
  return createDocumentCommand('Zmień rozmiar dokumentu', documentModel => {
    const previous = { width: documentModel.width, height: documentModel.height };
    if (options.scaleLayers) {
      const scaleX = width / Math.max(1, previous.width);
      const scaleY = height / Math.max(1, previous.height);
      for (const layer of documentModel.layers) {
        layer.transform = createTransform({
          ...layer.transform,
          x: layer.transform.x * scaleX,
          y: layer.transform.y * scaleY,
          scaleX: layer.transform.scaleX * scaleX,
          scaleY: layer.transform.scaleY * scaleY
        });
      }
    }
    documentModel.width = width;
    documentModel.height = height;
    documentModel.metadata = {
      ...documentModel.metadata,
      interpolation,
      previousDocumentSize: previous,
      canvasGeometryLocked: true
    };
    documentModel.touch();
    documentModel.emit('document:resize', { width, height, interpolation, scaleLayers: Boolean(options.scaleLayers) });
  });
}

export function createResizeLayerCommand(layerId, widthInput, heightInput, options = {}) {
  const width = dimension(widthInput);
  const height = dimension(heightInput);
  const interpolation = normalizeInterpolation(options.interpolation);
  return updateLayerCommand(layerId, {
    content: { width, height },
    metadata: { interpolation, manualSize: true }
  }, { label: 'Zmień rozmiar warstwy' });
}

export function createSetTransformCommand(layerId, transform, label = 'Przekształć warstwę') {
  return updateLayerCommand(layerId, { transform: createTransform(transform) }, { label });
}

export function createAddGuideCommand(axis, valueInput) {
  const orientation = axis === 'horizontal' ? 'horizontal' : 'vertical';
  const value = finite(valueInput, 0);
  return createDocumentCommand('Dodaj prowadnicę', documentModel => {
    const canvas = canvasMetadata(documentModel);
    const values = [...new Set([...(canvas.guides[orientation] ?? []), value])].sort((a, b) => a - b);
    canvas.guides[orientation] = values;
    setCanvasMetadata(documentModel, canvas, 'guide:add', { orientation, value });
  });
}

export function createRemoveGuideCommand(axis, valueInput, tolerance = 2) {
  const orientation = axis === 'horizontal' ? 'horizontal' : 'vertical';
  const value = finite(valueInput, 0);
  return createDocumentCommand('Usuń prowadnicę', documentModel => {
    const canvas = canvasMetadata(documentModel);
    canvas.guides[orientation] = (canvas.guides[orientation] ?? []).filter(item => Math.abs(item - value) > tolerance);
    setCanvasMetadata(documentModel, canvas, 'guide:remove', { orientation, value });
  });
}

export function createCanvasPreferencesCommand(patch = {}) {
  return createDocumentCommand('Zmień ustawienia płótna', documentModel => {
    const canvas = canvasMetadata(documentModel);
    if ('gridEnabled' in patch) canvas.gridEnabled = Boolean(patch.gridEnabled);
    if ('gridSize' in patch) canvas.gridSize = Math.max(2, finite(patch.gridSize, 32));
    if ('snapping' in patch) canvas.snapping = Boolean(patch.snapping);
    if ('guidesVisible' in patch) canvas.guidesVisible = Boolean(patch.guidesVisible);
    if ('rulersVisible' in patch) canvas.rulersVisible = Boolean(patch.rulersVisible);
    setCanvasMetadata(documentModel, canvas, 'canvas:preferences', { patch });
  });
}

export function getCanvasMetadata(documentModel) {
  return canvasMetadata(documentModel);
}

function canvasMetadata(documentModel) {
  const saved = documentModel.metadata?.canvas ?? {};
  return {
    gridEnabled: Boolean(saved.gridEnabled),
    gridSize: Math.max(2, finite(saved.gridSize, 32)),
    snapping: saved.snapping !== false,
    guidesVisible: saved.guidesVisible !== false,
    rulersVisible: saved.rulersVisible !== false,
    guides: {
      vertical: numericList(saved.guides?.vertical),
      horizontal: numericList(saved.guides?.horizontal)
    }
  };
}

function setCanvasMetadata(documentModel, canvas, eventType, detail) {
  documentModel.metadata = { ...documentModel.metadata, canvas };
  documentModel.touch();
  documentModel.emit(eventType, detail);
}

function numericList(values) {
  return [...new Set((values ?? []).map(value => finite(value, Number.NaN)).filter(Number.isFinite))].sort((a, b) => a - b);
}
function normalizeInterpolation(value) {
  return ['nearest', 'low', 'medium', 'high'].includes(value) ? value : 'high';
}
function dimension(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1 || number > 32768) throw new Error('Rozmiar musi mieścić się w zakresie 1–32768 px.');
  return number;
}
function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
