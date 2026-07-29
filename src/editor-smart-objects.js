import {
  combineMasks,
  connectedComponents,
  maskBounds,
  maskContains,
  normalizeMask,
  scaleMask
} from './editor-smart-mask.js';

export const SMART_CATEGORIES = Object.freeze(['person', 'product', 'car', 'sky', 'vegetation', 'other']);

const CATEGORY_LABELS = Object.freeze({
  person: 'Osoba',
  product: 'Produkt / przedmiot',
  car: 'Samochód / pojazd',
  sky: 'Niebo',
  vegetation: 'Roślinność',
  other: 'Inny obiekt'
});

const LABEL_GROUPS = Object.freeze({
  person: ['person', 'people', 'human', 'man', 'woman', 'boy', 'girl'],
  car: ['car', 'automobile', 'vehicle', 'truck', 'bus', 'van', 'motorcycle', 'motorbike', 'bicycle', 'bike'],
  sky: ['sky'],
  vegetation: ['tree', 'grass', 'plant', 'flower', 'field', 'earth', 'mountain', 'hill', 'palm', 'vegetation', 'forest'],
  product: [
    'bottle', 'cup', 'glass', 'book', 'laptop', 'computer', 'keyboard', 'mouse', 'phone', 'cell phone',
    'tv', 'monitor', 'chair', 'table', 'desk', 'sofa', 'bag', 'handbag', 'backpack', 'suitcase',
    'shoe', 'clock', 'vase', 'scissors', 'toothbrush', 'remote', 'camera', 'microwave', 'oven',
    'refrigerator', 'toaster', 'sink', 'bed', 'potted plant', 'toy', 'product'
  ]
});

export function normalizeSmartCategory(labelInput) {
  const label = String(labelInput ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  for (const [category, names] of Object.entries(LABEL_GROUPS)) {
    if (names.some(name => label === name || label.includes(name))) return category;
  }
  return 'other';
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;
}

export function normalizeSemanticSegments(results, targetWidth, targetHeight, options = {}) {
  const objects = [];
  const minPixels = Math.max(1, Math.trunc(Number(options.minPixels) || Math.max(8, targetWidth * targetHeight * 0.0003)));
  for (const [resultIndex, result] of (results ?? []).entries()) {
    const rawMask = extractMask(result?.mask ?? result?.segmentation ?? result);
    if (!rawMask) continue;
    const mask = scaleMask(rawMask.data, rawMask.width, rawMask.height, targetWidth, targetHeight);
    const components = connectedComponents(mask, targetWidth, targetHeight, { threshold: options.threshold ?? 96, minPixels });
    const label = result?.label ?? result?.class ?? result?.category ?? `segment-${resultIndex + 1}`;
    const category = normalizeSmartCategory(label);
    for (const [componentIndex, component] of components.entries()) {
      const bounds = maskBounds(component, targetWidth, targetHeight, 1);
      if (!bounds) continue;
      objects.push(createSmartObject({
        id: `semantic-${resultIndex}-${componentIndex}`,
        label,
        category,
        score: scoreOf(result),
        mask: component,
        width: targetWidth,
        height: targetHeight,
        bounds,
        source: 'semantic'
      }));
    }
  }
  return objects;
}

export function normalizeDetections(results, width, height, options = {}) {
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.25;
  const objects = [];
  for (const [index, result] of (results ?? []).entries()) {
    const score = scoreOf(result);
    if (score < threshold) continue;
    const box = normalizeBox(result?.box ?? result?.bbox ?? result, width, height);
    if (!box || box.width < 1 || box.height < 1) continue;
    const label = result?.label ?? result?.class ?? `object-${index + 1}`;
    objects.push(createSmartObject({
      id: `detection-${index}`,
      label,
      category: normalizeSmartCategory(label),
      score,
      mask: rectangularMask(width, height, box, options.boxFeather ?? 0),
      width,
      height,
      bounds: box,
      source: 'detection'
    }));
  }
  return objects;
}

export function mergeSmartObjects(detections, semantic, options = {}) {
  const iouThreshold = Number.isFinite(Number(options.iouThreshold)) ? Number(options.iouThreshold) : 0.35;
  const merged = [];
  const usedSemantic = new Set();
  for (const detection of detections ?? []) {
    let best = null;
    let bestIndex = -1;
    let bestOverlap = 0;
    for (let index = 0; index < (semantic ?? []).length; index += 1) {
      if (usedSemantic.has(index)) continue;
      const candidate = semantic[index];
      if (candidate.category !== detection.category && detection.category !== 'other') continue;
      const overlap = intersectionOverUnion(detection.bounds, candidate.bounds);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = candidate;
        bestIndex = index;
      }
    }
    if (best && bestOverlap >= iouThreshold) {
      usedSemantic.add(bestIndex);
      const mask = combineMasks([detection.mask, best.mask], detection.width, detection.height, 'intersect');
      const effective = maskBounds(mask, detection.width, detection.height, 1) ? mask : best.mask;
      merged.push(createSmartObject({
        ...detection,
        id: `merged-${detection.id}-${best.id}`,
        label: detection.label,
        category: detection.category === 'other' ? best.category : detection.category,
        score: Math.max(detection.score, best.score),
        mask: effective,
        bounds: maskBounds(effective, detection.width, detection.height, 1) ?? best.bounds,
        source: 'detection+semantic',
        sourceIds: [detection.id, best.id]
      }));
    } else merged.push(detection);
  }
  for (let index = 0; index < (semantic ?? []).length; index += 1) if (!usedSemantic.has(index)) merged.push(semantic[index]);
  return deduplicateObjects(merged, options.deduplicateIou ?? 0.82);
}

export function createPersonObjectFromMask(maskInput, width, height, options = {}) {
  const mask = normalizeMask(maskInput, width, height);
  const bounds = maskBounds(mask, width, height, 1);
  if (!bounds) return null;
  return createSmartObject({
    id: options.id ?? 'modnet-person',
    label: options.label ?? 'person',
    category: 'person',
    score: Number.isFinite(Number(options.score)) ? Number(options.score) : 1,
    mask,
    width,
    height,
    bounds,
    source: options.source ?? 'modnet'
  });
}

export function hitTestSmartObjects(objects, x, y, options = {}) {
  const threshold = Number(options.threshold) || 128;
  const hits = (objects ?? []).filter(object => maskContains(object.mask, object.width, object.height, x, y, threshold));
  hits.sort((a, b) => objectArea(a) - objectArea(b) || b.score - a.score);
  return hits;
}

export function combineSelectedObjects(objects, selectedIds, width, height, mode = 'union') {
  const selected = new Set(selectedIds ?? []);
  const masks = (objects ?? []).filter(object => selected.has(object.id)).map(object => object.mask);
  return combineMasks(masks, width, height, mode);
}

export function serializeSmartObject(object) {
  return {
    id: object.id,
    label: object.label,
    category: object.category,
    categoryLabel: object.categoryLabel,
    score: object.score,
    width: object.width,
    height: object.height,
    bounds: { ...object.bounds },
    source: object.source,
    sourceIds: [...(object.sourceIds ?? [])]
  };
}

export function intersectionOverUnion(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function createSmartObject(value) {
  const category = SMART_CATEGORIES.includes(value.category) ? value.category : 'other';
  return {
    id: String(value.id),
    label: String(value.label ?? category),
    category,
    categoryLabel: categoryLabel(category),
    score: clamp(Number(value.score) || 0, 0, 1),
    mask: normalizeMask(value.mask, value.width, value.height),
    width: value.width,
    height: value.height,
    bounds: { ...value.bounds },
    source: String(value.source ?? 'unknown'),
    sourceIds: [...(value.sourceIds ?? [])]
  };
}

function extractMask(value) {
  if (!value) return null;
  const data = value.data ?? value.mask ?? value;
  const width = Math.trunc(Number(value.width ?? value.dims?.at?.(-1) ?? value.size?.[0]));
  const height = Math.trunc(Number(value.height ?? value.dims?.at?.(-2) ?? value.size?.[1]));
  if (!data || !width || !height || data.length < width * height) return null;
  return { data: data.length === width * height ? data : data.slice(data.length - width * height), width, height };
}

function scoreOf(result) {
  const score = Number(result?.score ?? result?.confidence ?? 1);
  return Number.isFinite(score) ? clamp(score, 0, 1) : 1;
}

function normalizeBox(box, width, height) {
  let left = Number(box?.xmin ?? box?.x ?? box?.left);
  let top = Number(box?.ymin ?? box?.y ?? box?.top);
  let right = Number(box?.xmax ?? box?.right);
  let bottom = Number(box?.ymax ?? box?.bottom);
  if (!Number.isFinite(right) && Number.isFinite(Number(box?.width))) right = left + Number(box.width);
  if (!Number.isFinite(bottom) && Number.isFinite(Number(box?.height))) bottom = top + Number(box.height);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  left = clamp(Math.floor(left), 0, width - 1);
  top = clamp(Math.floor(top), 0, height - 1);
  right = clamp(Math.ceil(right), left + 1, width);
  bottom = clamp(Math.ceil(bottom), top + 1, height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectangularMask(width, height, bounds, feather = 0) {
  const output = new Uint8Array(width * height);
  const radius = Math.max(0, Number(feather) || 0);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
    let alpha = 255;
    if (radius > 0) {
      const edge = Math.min(x - bounds.x + 1, bounds.x + bounds.width - x, y - bounds.y + 1, bounds.y + bounds.height - y);
      alpha = Math.round(clamp(edge / radius, 0, 1) * 255);
    }
    output[y * width + x] = alpha;
  }
  return output;
}

function deduplicateObjects(objects, threshold) {
  const output = [];
  for (const object of [...objects].sort((a, b) => b.score - a.score)) {
    if (output.some(existing => existing.category === object.category && intersectionOverUnion(existing.bounds, object.bounds) >= threshold)) continue;
    output.push(object);
  }
  return output;
}

function objectArea(object) {
  return object.bounds.width * object.bounds.height;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
