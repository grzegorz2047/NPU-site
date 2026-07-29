import { cloneLayer } from './editor-document.js';

export const HISTORY_SCHEMA_VERSION = 1;

export class SnapshotCommand {
  constructor(label, mutate, options = {}) {
    if (typeof mutate !== 'function') throw new TypeError('Komenda wymaga funkcji mutującej dokument.');
    this.label = String(label || 'Operacja');
    this.mutate = mutate;
    this.coalesceKey = options.coalesceKey ?? null;
    this.before = null;
    this.after = null;
  }

  execute(document) {
    if (this.after) {
      document.restore(this.after);
      return;
    }
    this.before = document.toJSON();
    this.mutate(document);
    this.after = document.toJSON();
  }

  undo(document) {
    if (!this.before) throw new Error('Nie można cofnąć niewykonanej komendy.');
    document.restore(this.before);
  }

  merge(command) {
    if (!this.coalesceKey || command.coalesceKey !== this.coalesceKey || !command.after) return false;
    this.after = clonePlain(command.after);
    this.label = command.label;
    return true;
  }

  toJSON() {
    return {
      version: HISTORY_SCHEMA_VERSION,
      label: this.label,
      coalesceKey: this.coalesceKey,
      before: clonePlain(this.before),
      after: clonePlain(this.after)
    };
  }

  static fromJSON(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Nieprawidłowy zapis komendy historii.');
    if (Number(snapshot.version ?? 1) > HISTORY_SCHEMA_VERSION) throw new Error('Historia została zapisana w nowszej wersji aplikacji.');
    const command = new SnapshotCommand(snapshot.label, () => {}, { coalesceKey: snapshot.coalesceKey ?? null });
    command.before = snapshot.before ? clonePlain(snapshot.before) : null;
    command.after = snapshot.after ? clonePlain(snapshot.after) : null;
    if (!command.before || !command.after) throw new Error('Zapis komendy historii jest niekompletny.');
    return command;
  }
}

export class CommandHistory {
  constructor({ limit = 100 } = {}) {
    this.limit = normalizeLimit(limit);
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, command = null) {
    const state = {
      type,
      command,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length
    };
    for (const listener of this.listeners) listener(state);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  execute(command, document) {
    assertCommand(command);
    command.execute(document);
    const previous = this.undoStack.at(-1);
    if (!(previous?.merge?.(command))) {
      this.undoStack.push(command);
      this.trim();
    }
    this.redoStack.length = 0;
    this.emit('execute', command);
    return command;
  }

  undo(document) {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo(document);
    this.redoStack.push(command);
    this.emit('undo', command);
    return true;
  }

  redo(document) {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute(document);
    this.undoStack.push(command);
    this.trim();
    this.emit('redo', command);
    return true;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit('clear');
  }

  setLimit(limit) {
    this.limit = normalizeLimit(limit);
    this.trim();
    this.emit('limit');
  }

  trim() {
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    if (this.redoStack.length > this.limit) this.redoStack.splice(0, this.redoStack.length - this.limit);
  }

  toJSON() {
    return {
      version: HISTORY_SCHEMA_VERSION,
      limit: this.limit,
      undo: this.undoStack.map(command => command.toJSON()),
      redo: this.redoStack.map(command => command.toJSON())
    };
  }

  restore(snapshot, { emit = true } = {}) {
    if (!snapshot) {
      this.clear();
      return this;
    }
    if (Number(snapshot.version ?? 1) > HISTORY_SCHEMA_VERSION) throw new Error('Historia została zapisana w nowszej wersji aplikacji.');
    this.limit = normalizeLimit(snapshot.limit ?? this.limit);
    this.undoStack = (snapshot.undo ?? []).map(item => SnapshotCommand.fromJSON(item));
    this.redoStack = (snapshot.redo ?? []).map(item => SnapshotCommand.fromJSON(item));
    this.trim();
    if (emit) this.emit('restore');
    return this;
  }
}

export function createDocumentCommand(label, mutate, options) { return new SnapshotCommand(label, mutate, options); }
export function addLayerCommand(layer, index, parentId = null) {
  const layerSnapshot = clonePlain(layer);
  return createDocumentCommand(`Dodaj: ${layer.name}`, document => document.addLayer(layerSnapshot, index, parentId));
}
export function removeLayerCommand(layerId) { return createDocumentCommand('Usuń warstwę', document => document.removeLayer(layerId)); }
export function duplicateLayerCommand(layerId) {
  return createDocumentCommand('Duplikuj warstwę', document => {
    const source = document.getLayer(layerId);
    if (!source) throw new Error(`Nie znaleziono warstwy ${layerId}.`);
    document.duplicateLayer(layerId);
  });
}
export function moveLayerCommand(layerId, targetIndex) { return createDocumentCommand('Zmień kolejność warstw', document => document.moveLayer(layerId, targetIndex)); }
export function updateLayerCommand(layerId, patch, options = {}) {
  return createDocumentCommand(options.label ?? labelForPatch(patch), document => document.updateLayer(layerId, patch), { coalesceKey: options.coalesceKey ?? null });
}
export function setLayerVisibilityCommand(layerId, visible) { return updateLayerCommand(layerId, { visible }, { label: visible ? 'Pokaż warstwę' : 'Ukryj warstwę' }); }
export function setLayerOpacityCommand(layerId, opacity) { return updateLayerCommand(layerId, { opacity }, { label: 'Zmień krycie warstwy', coalesceKey: `layer:${layerId}:opacity` }); }
export function setLayerNameCommand(layerId, name) { return updateLayerCommand(layerId, { name }, { label: 'Zmień nazwę warstwy' }); }
export function setLayerTransformCommand(layerId, transform) { return updateLayerCommand(layerId, { transform }, { label: 'Przekształć warstwę', coalesceKey: `layer:${layerId}:transform` }); }
export function setSelectionCommand(ids, activeLayerId = null) { return createDocumentCommand('Zmień zaznaczenie warstw', document => document.setSelectedLayers(ids, activeLayerId)); }

function labelForPatch(patch) {
  if ('visible' in patch) return 'Zmień widoczność warstwy';
  if ('opacity' in patch) return 'Zmień krycie warstwy';
  if ('name' in patch) return 'Zmień nazwę warstwy';
  if ('transform' in patch) return 'Przekształć warstwę';
  if ('blendMode' in patch) return 'Zmień tryb mieszania';
  if ('locked' in patch) return 'Zmień blokadę warstwy';
  if ('mask' in patch) return 'Zmień maskę warstwy';
  if ('clipping' in patch) return 'Zmień maskę przycinającą';
  return 'Zmień warstwę';
}
function assertCommand(command) {
  if (!command || typeof command.execute !== 'function' || typeof command.undo !== 'function') throw new TypeError('Nieprawidłowa komenda historii.');
}
function normalizeLimit(limit) {
  const number = Math.trunc(Number(limit));
  return Number.isFinite(number) && number > 0 ? number : 100;
}
function clonePlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
