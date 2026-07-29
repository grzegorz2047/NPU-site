import { referencedAssetIds } from './editor-project-format.js';

export async function collectDocumentAssets(documentModel, historySnapshot = null) {
  const assets = new Map();
  for (const assetId of referencedAssetIds(documentModel.toJSON(), historySnapshot)) {
    const runtimeAsset = documentModel.getRuntimeAsset(assetId);
    if (!runtimeAsset) throw new Error(`Nie można zapisać projektu: brakuje zasobu ${assetId}.`);
    assets.set(assetId, await runtimeAssetToBlob(runtimeAsset));
  }
  return assets;
}

export async function restoreDocumentAssets(documentModel, assets) {
  documentModel.clearRuntimeAssets();
  for (const [assetId, blob] of assets) documentModel.setRuntimeAsset(assetId, await blobToRuntimeAsset(blob));
}

export async function runtimeAssetToBlob(asset, type = 'image/png') {
  if (asset instanceof Blob) return asset;
  if (asset instanceof ArrayBuffer || ArrayBuffer.isView(asset)) return new Blob([asset], { type: 'application/octet-stream' });
  if (typeof OffscreenCanvas !== 'undefined' && asset instanceof OffscreenCanvas) return asset.convertToBlob({ type });
  if (asset?.toBlob && typeof asset.toBlob === 'function') {
    return new Promise((resolve, reject) => asset.toBlob(blob => blob ? resolve(blob) : reject(new Error('Nie udało się zakodować zasobu canvas.')), type));
  }
  const width = Number(asset?.width || asset?.naturalWidth);
  const height = Number(asset?.height || asset?.naturalHeight);
  if (width > 0 && height > 0 && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(asset, 0, 0, width, height);
    return runtimeAssetToBlob(canvas, type);
  }
  throw new TypeError('Nieobsługiwany zasób obrazu.');
}

export async function blobToRuntimeAsset(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('Zapisany zasób nie jest Blobem.');
  if (blob.type.startsWith('image/')) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    if (typeof document !== 'undefined') return loadImage(blob);
  }
  return blob;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się odtworzyć zasobu obrazu.')); };
    image.src = url;
  });
}
