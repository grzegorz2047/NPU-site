export const LAYER_TYPES = Object.freeze(['raster', 'text', 'shape', 'group']);
export const BLEND_MODES = Object.freeze(['normal', 'multiply', 'screen', 'overlay']);

let fallbackId = 0;

export function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  fallbackId += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function clampOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}

export function createTransform(transform = {}) {
  return {
    x: finite(transform.x, 0),
    y: finite(transform.y, 0),
    scaleX: finite(transform.scaleX, 1),
    scaleY: finite(transform.scaleY, 1),
    rotation: finite(transform.rotation, 0),
    skewX: finite(transform.skewX, 0),
    skewY: finite(transform.skewY, 0),
    originX: finite(transform.originX, 0),
    originY: finite(transform.originY, 0)
  };
}

export function createLayerMask(mask = {}) {
  return {
    enabled: mask.enabled !== false,
    assetId: mask.assetId ?? null,
    opacity: clampOpacity(mask.opacity ?? 1),
    inverted: Boolean(mask.inverted),
    feather: Math.max(0, finite(mask.feather, 0)),
    metadata: cloneValue(mask.metadata ?? {})
  };
}

export function createClippingMask(clipping = {}) {
  return {
    enabled: Boolean(clipping.enabled),
    baseLayerId: clipping.baseLayerId ?? null
  };
}

export function createLayer(type, options = {}) {
  if (!LAYER_TYPES.includes(type)) throw new TypeError(`Nieobsługiwany typ warstwy: ${type}`);
  const layer = {
    id: options.id ?? createId('layer'),
    name: String(options.name ?? defaultLayerName(type)),
    type,
    visible: options.visible !== false,
    locked: Boolean(options.locked),
    opacity: clampOpacity(options.opacity ?? 1),
    blendMode: BLEND_MODES.includes(options.blendMode) ? options.blendMode : 'normal',
    transform: createTransform(options.transform),
    mask: options.mask ? createLayerMask(options.mask) : null,
    clipping: createClippingMask(options.clipping),
    metadata: cloneValue(options.metadata ?? {}),
    content: normalizeContent(type, options.content ?? options)
  };
  if (type === 'group') layer.children = (options.children ?? []).map(child => normalizeLayer(child));
  return layer;
}

export const createRasterLayer = options => createLayer('raster', options);
export const createTextLayer = options => createLayer('text', options);
export const createShapeLayer = options => createLayer('shape', options);
export const createGroupLayer = options => createLayer('group', options);

export function normalizeLayer(layer) {
  if (!layer || typeof layer !== 'object') throw new TypeError('Warstwa musi być obiektem.');
  return createLayer(layer.type, layer);
}

export function cloneLayer(layer, { regenerateIds = true, suffix = ' kopia' } = {}) {
  const cloned = normalizeLayer(cloneValue(layer));
  const renew = item => {
    if (regenerateIds) item.id = createId('layer');
    if (item.type === 'group') item.children.forEach(renew);
  };
  renew(cloned);
  cloned.name = `${layer.name}${suffix}`;
  return cloned;
}

export function createEditorDocument(options = {}) {
  return new EditorDocument(options);
}

export class EditorDocument {
  constructor(options = {}) {
    this.runtimeAssets = new Map();
    this.listeners = new Set();
    this.restore({
      id: options.id ?? createId('document'),
      name: options.name ?? 'Bez nazwy',
      width: options.width ?? 1,
      height: options.height ?? 1,
      createdAt: options.createdAt ?? new Date().toISOString(),
      updatedAt: options.updatedAt ?? new Date().toISOString(),
      metadata: options.metadata ?? {},
      layers: options.layers ?? [],
      activeLayerId: options.activeLayerId ?? null,
      selectedLayerIds: options.selectedLayerIds ?? []
    }, { emit: false });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type = 'change', detail = {}) {
    const event = { type, document: this, ...detail };
    for (const listener of this.listeners) listener(event);
  }

  touch() {
    this.updatedAt = new Date().toISOString();
  }

  getLayer(id) {
    return findLayer(this.layers, id);
  }

  getLayerIndex(id) {
    return this.layers.findIndex(layer => layer.id === id);
  }

  get activeLayer() {
    return this.getLayer(this.activeLayerId);
  }

  addLayer(layer, index = this.layers.length) {
    const normalized = normalizeLayer(layer);
    if (this.getLayer(normalized.id)) throw new Error(`Warstwa ${normalized.id} już istnieje.`);
    const target = clampIndex(index, this.layers.length + 1);
    this.layers.splice(target, 0, normalized);
    this.setSelection([normalized.id], normalized.id, { emit: false });
    this.touch();
    this.emit('layer:add', { layer: normalized, index: target });
    return normalized;
  }

  removeLayer(id) {
    const index = this.getLayerIndex(id);
    if (index < 0) return null;
    const [removed] = this.layers.splice(index, 1);
    this.selectedLayerIds = this.selectedLayerIds.filter(layerId => layerId !== id);
    if (this.activeLayerId === id) {
      const replacement = this.layers[Math.min(index, this.layers.length - 1)] ?? null;
      this.activeLayerId = replacement?.id ?? null;
      this.selectedLayerIds = replacement ? [replacement.id] : [];
    }
    this.touch();
    this.emit('layer:remove', { layer: removed, index });
    return removed;
  }

  duplicateLayer(id, index = null) {
    const sourceIndex = this.getLayerIndex(id);
    if (sourceIndex < 0) throw new Error(`Nie znaleziono warstwy ${id}.`);
    const duplicate = cloneLayer(this.layers[sourceIndex]);
    return this.addLayer(duplicate, index ?? sourceIndex + 1);
  }

  moveLayer(id, targetIndex) {
    const sourceIndex = this.getLayerIndex(id);
    if (sourceIndex < 0) throw new Error(`Nie znaleziono warstwy ${id}.`);
    const boundedTarget = clampIndex(targetIndex, this.layers.length);
    if (sourceIndex === boundedTarget) return sourceIndex;
    const [layer] = this.layers.splice(sourceIndex, 1);
    const adjustedTarget = clampIndex(boundedTarget, this.layers.length + 1);
    this.layers.splice(adjustedTarget, 0, layer);
    this.touch();
    this.emit('layer:move', { layer, from: sourceIndex, to: adjustedTarget });
    return adjustedTarget;
  }

  updateLayer(id, patch = {}) {
    const layer = this.getLayer(id);
    if (!layer) throw new Error(`Nie znaleziono warstwy ${id}.`);
    if ('name' in patch) layer.name = String(patch.name || defaultLayerName(layer.type));
    if ('visible' in patch) layer.visible = Boolean(patch.visible);
    if ('locked' in patch) layer.locked = Boolean(patch.locked);
    if ('opacity' in patch) layer.opacity = clampOpacity(patch.opacity);
    if ('blendMode' in patch) {
      if (!BLEND_MODES.includes(patch.blendMode)) throw new Error(`Nieobsługiwany tryb mieszania: ${patch.blendMode}`);
      layer.blendMode = patch.blendMode;
    }
    if ('transform' in patch) layer.transform = createTransform({ ...layer.transform, ...patch.transform });
    if ('mask' in patch) layer.mask = patch.mask ? createLayerMask(patch.mask) : null;
    if ('clipping' in patch) layer.clipping = createClippingMask({ ...layer.clipping, ...patch.clipping });
    if ('metadata' in patch) layer.metadata = cloneValue({ ...layer.metadata, ...patch.metadata });
    if ('content' in patch) layer.content = normalizeContent(layer.type, { ...layer.content, ...patch.content });
    this.touch();
    this.emit('layer:update', { layer, patch: cloneValue(patch) });
    return layer;
  }

  setActiveLayer(id, options = {}) {
    if (id !== null && !this.getLayer(id)) throw new Error(`Nie znaleziono warstwy ${id}.`);
    if (options.preserveSelection) {
      const selected = new Set(this.selectedLayerIds);
      if (id) selected.add(id);
      this.setSelection([...selected], id);
    } else {
      this.setSelection(id ? [id] : [], id);
    }
  }

  setSelectedLayers(ids, activeLayerId = null) {
    this.setSelection(ids, activeLayerId);
  }

  setSelection(ids, activeLayerId = null, { emit = true } = {}) {
    const unique = [...new Set(ids)].filter(id => Boolean(this.getLayer(id)));
    const active = activeLayerId && unique.includes(activeLayerId)
      ? activeLayerId
      : unique.at(-1) ?? null;
    this.selectedLayerIds = unique;
    this.activeLayerId = active;
    if (emit) this.emit('selection:change', { selectedLayerIds: unique, activeLayerId: active });
  }

  setRuntimeAsset(assetId, value) {
    if (!assetId) throw new Error('Identyfikator zasobu jest wymagany.');
    this.runtimeAssets.set(assetId, value);
    this.emit('asset:update', { assetId });
    return assetId;
  }

  getRuntimeAsset(assetId) {
    return this.runtimeAssets.get(assetId) ?? null;
  }

  deleteRuntimeAsset(assetId) {
    return this.runtimeAssets.delete(assetId);
  }

  clearRuntimeAssets() {
    this.runtimeAssets.clear();
  }

  restore(snapshot, { emit = true, preserveRuntimeAssets = true } = {}) {
    const width = documentDimension(snapshot.width, 1);
    const height = documentDimension(snapshot.height, 1);
    this.id = String(snapshot.id ?? createId('document'));
    this.name = String(snapshot.name ?? 'Bez nazwy');
    this.width = width;
    this.height = height;
    this.createdAt = snapshot.createdAt ?? new Date().toISOString();
    this.updatedAt = snapshot.updatedAt ?? new Date().toISOString();
    this.metadata = cloneValue(snapshot.metadata ?? {});
    this.layers = (snapshot.layers ?? []).map(normalizeLayer);
    const validIds = new Set(flattenLayers(this.layers).map(layer => layer.id));
    this.selectedLayerIds = [...new Set(snapshot.selectedLayerIds ?? [])].filter(id => validIds.has(id));
    this.activeLayerId = validIds.has(snapshot.activeLayerId)
      ? snapshot.activeLayerId
      : this.selectedLayerIds.at(-1) ?? this.layers.at(-1)?.id ?? null;
    if (this.activeLayerId && !this.selectedLayerIds.includes(this.activeLayerId)) this.selectedLayerIds.push(this.activeLayerId);
    if (!preserveRuntimeAssets) this.runtimeAssets.clear();
    if (emit) this.emit('document:restore');
    return this;
  }

  toJSON() {
    return {
      version: 1,
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: cloneValue(this.metadata),
      layers: cloneValue(this.layers),
      activeLayerId: this.activeLayerId,
      selectedLayerIds: [...this.selectedLayerIds]
    };
  }
}

export function flattenLayers(layers) {
  const output = [];
  const visit = layer => {
    output.push(layer);
    if (layer.type === 'group') layer.children.forEach(visit);
  };
  layers.forEach(visit);
  return output;
}

function normalizeContent(type, content) {
  if (type === 'raster') {
    return {
      assetId: content.assetId ?? null,
      width: positiveInteger(content.width, 0),
      height: positiveInteger(content.height, 0)
    };
  }
  if (type === 'text') {
    return {
      text: String(content.text ?? ''),
      fontFamily: String(content.fontFamily ?? 'sans-serif'),
      fontSize: Math.max(1, finite(content.fontSize, 32)),
      fontWeight: String(content.fontWeight ?? '400'),
      color: String(content.color ?? '#ffffff'),
      align: ['left', 'center', 'right'].includes(content.align) ? content.align : 'left',
      maxWidth: Math.max(0, finite(content.maxWidth, 0))
    };
  }
  if (type === 'shape') {
    return {
      shape: ['rectangle', 'ellipse', 'line'].includes(content.shape) ? content.shape : 'rectangle',
      width: Math.max(0, finite(content.width, 100)),
      height: Math.max(0, finite(content.height, 100)),
      fill: content.fill === null ? null : String(content.fill ?? '#31c48d'),
      stroke: content.stroke === null ? null : String(content.stroke ?? '#ffffff'),
      strokeWidth: Math.max(0, finite(content.strokeWidth, 0)),
      radius: Math.max(0, finite(content.radius, 0))
    };
  }
  return {};
}

function findLayer(layers, id) {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.type === 'group') {
      const nested = findLayer(layer.children, id);
      if (nested) return nested;
    }
  }
  return null;
}

function defaultLayerName(type) {
  return ({ raster: 'Warstwa rastrowa', text: 'Warstwa tekstowa', shape: 'Kształt', group: 'Grupa' })[type];
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function documentDimension(value, fallback) {
  return Math.max(1, positiveInteger(value, fallback));
}

function clampIndex(index, length) {
  const number = Math.trunc(Number(index));
  if (!Number.isFinite(number)) return Math.max(0, length - 1);
  return Math.min(Math.max(0, number), Math.max(0, length - 1));
}
