import { createMatrix, invertMatrix } from './editor-canvas-geometry.js';
import { createSelection, rasterizeSelection } from './editor-selection.js';

export function restrictAdjustmentToSelection(original, adjusted, selectionInput, options = {}) {
  if (!selectionInput || (!selectionInput.entries?.length && !selectionInput.inverted)) return adjusted;
  const documentWidth = Math.max(1, Math.round(Number(options.documentWidth) || adjusted.width || 1));
  const documentHeight = Math.max(1, Math.round(Number(options.documentHeight) || adjusted.height || 1));
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const selection = createSelection({ ...selectionInput, width: selectionInput.width ?? documentWidth, height: selectionInput.height ?? documentHeight });
  const mask = rasterizeSelection(selection, documentWidth, documentHeight);
  const documentMask = createCanvas(documentWidth, documentHeight);
  const documentContext = documentMask.getContext('2d');
  if (!documentContext?.createImageData || !documentContext?.putImageData) return adjusted;
  const imageData = documentContext.createImageData(documentWidth, documentHeight);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    imageData.data[offset] = imageData.data[offset + 1] = imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = mask[index];
  }
  documentContext.putImageData(imageData, 0, 0);

  const sourceMask = createCanvas(adjusted.width, adjusted.height);
  const sourceMaskContext = sourceMask.getContext('2d');
  try {
    const inverse = invertMatrix(createMatrix(options.transform));
    sourceMaskContext.setTransform?.(...inverse);
    sourceMaskContext.drawImage(documentMask, 0, 0);
    sourceMaskContext.setTransform?.(1, 0, 0, 1, 0, 0);
  } catch {
    return adjusted;
  }

  const selectedAdjustment = createCanvas(adjusted.width, adjusted.height);
  const selectedContext = selectedAdjustment.getContext('2d');
  selectedContext.drawImage(adjusted, 0, 0);
  selectedContext.globalCompositeOperation = 'destination-in';
  selectedContext.drawImage(sourceMask, 0, 0);
  selectedContext.globalCompositeOperation = 'source-over';

  const output = createCanvas(adjusted.width, adjusted.height);
  const outputContext = output.getContext('2d');
  outputContext.drawImage(original, 0, 0);
  outputContext.drawImage(selectedAdjustment, 0, 0);
  return output;
}

function defaultCreateCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
