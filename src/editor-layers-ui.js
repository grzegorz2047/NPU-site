import { createRasterLayer } from './editor-document.js';
import {
  addLayerCommand,
  createDocumentCommand,
  duplicateLayerCommand,
  moveLayerCommand,
  removeLayerCommand,
  setLayerNameCommand,
  setLayerOpacityCommand,
  setLayerVisibilityCommand,
  updateLayerCommand
} from './editor-history.js';

const ICONS = Object.freeze({ raster: '▧', text: 'T', shape: '◆', group: '▣' });

export class LayersPanel {
  constructor({ documentModel, history, renderer, root = document } = {}) {
    this.documentModel = documentModel;
    this.history = history;
    this.renderer = renderer;
    this.root = root;
    this.lastSelectedId = null;
    this.elements = this.resolveElements();
    this.bind();
    this.unsubscribeDocument = this.documentModel.subscribe(() => this.refresh());
    this.unsubscribeHistory = this.history.subscribe(() => this.refreshHistory());
    this.refresh();
  }

  destroy() {
    this.unsubscribeDocument?.();
    this.unsubscribeHistory?.();
  }

  setDocument(documentModel) {
    this.unsubscribeDocument?.();
    this.documentModel = documentModel;
    this.unsubscribeDocument = this.documentModel.subscribe(() => this.refresh());
    this.refresh();
  }

  resolveElements() {
    const get = id => this.root.getElementById?.(id) ?? this.root.querySelector?.(`#${id}`);
    return {
      list: get('layers-list'),
      selection: get('layers-selection'),
      blend: get('layer-blend-mode'),
      opacity: get('layer-opacity'),
      opacityOutput: get('layer-opacity-output'),
      add: get('layer-add'),
      duplicate: get('layer-duplicate'),
      remove: get('layer-remove'),
      up: get('layer-up'),
      down: get('layer-down'),
      undo: get('undo-button'),
      redo: get('redo-button')
    };
  }

  bind() {
    const e = this.elements;
    e.add?.addEventListener('click', () => {
      const layer = createRasterLayer({ name: 'Nowa warstwa' });
      this.execute(addLayerCommand(layer));
    });
    e.duplicate?.addEventListener('click', () => {
      if (this.documentModel.activeLayerId) this.execute(duplicateLayerCommand(this.documentModel.activeLayerId));
    });
    e.remove?.addEventListener('click', () => this.removeSelection());
    e.up?.addEventListener('click', () => this.moveActive(1));
    e.down?.addEventListener('click', () => this.moveActive(-1));
    e.undo?.addEventListener('click', () => this.undo());
    e.redo?.addEventListener('click', () => this.redo());
    e.blend?.addEventListener('change', () => {
      const layer = this.documentModel.activeLayer;
      if (layer && !layer.locked) this.execute(updateLayerCommand(layer.id, { blendMode: e.blend.value }));
    });
    e.opacity?.addEventListener('input', () => {
      const layer = this.documentModel.activeLayer;
      if (layer && !layer.locked) this.execute(setLayerOpacityCommand(layer.id, Number(e.opacity.value) / 100));
    });
    this.root.addEventListener?.('keydown', event => this.handleShortcut(event));
  }

  execute(command) {
    this.history.execute(command, this.documentModel);
    this.renderDocument();
  }

  undo() {
    if (this.history.undo(this.documentModel)) this.renderDocument();
  }

  redo() {
    if (this.history.redo(this.documentModel)) this.renderDocument();
  }

  renderDocument() {
    this.renderer?.render(this.documentModel);
  }

  removeSelection() {
    const ids = this.documentModel.selectedLayerIds.length
      ? [...this.documentModel.selectedLayerIds]
      : this.documentModel.activeLayerId ? [this.documentModel.activeLayerId] : [];
    if (!ids.length) return;
    if (ids.length === 1) {
      this.execute(removeLayerCommand(ids[0]));
      return;
    }
    this.execute(createDocumentCommand('Usuń warstwy', documentModel => {
      for (const id of ids) documentModel.removeLayer(id);
    }));
  }

  moveActive(delta) {
    const id = this.documentModel.activeLayerId;
    const index = this.documentModel.getLayerIndex(id);
    if (index < 0) return;
    const target = Math.min(this.documentModel.layers.length - 1, Math.max(0, index + delta));
    if (target !== index) this.execute(moveLayerCommand(id, target));
  }

  handleShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (isEditable(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      this.redo();
    } else if (key === 'z') {
      event.preventDefault();
      this.undo();
    } else if (key === 'y') {
      event.preventDefault();
      this.redo();
    }
  }

  selectLayer(layerId, event) {
    const ordered = [...this.documentModel.layers].reverse().map(layer => layer.id);
    if (event.shiftKey && this.lastSelectedId && ordered.includes(this.lastSelectedId)) {
      const from = ordered.indexOf(this.lastSelectedId);
      const to = ordered.indexOf(layerId);
      const ids = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
      this.documentModel.setSelectedLayers(ids, layerId);
    } else if (event.ctrlKey || event.metaKey) {
      const selected = new Set(this.documentModel.selectedLayerIds);
      if (selected.has(layerId)) selected.delete(layerId);
      else selected.add(layerId);
      this.documentModel.setSelectedLayers([...selected], selected.has(layerId) ? layerId : [...selected].at(-1) ?? null);
    } else {
      this.documentModel.setActiveLayer(layerId);
    }
    this.lastSelectedId = layerId;
    this.refresh();
  }

  refresh() {
    this.renderList();
    this.refreshProperties();
    this.refreshHistory();
  }

  renderList() {
    const list = this.elements.list;
    if (!list) return;
    list.replaceChildren();
    const layers = [...this.documentModel.layers].reverse();
    if (!layers.length) {
      const empty = document.createElement('p');
      empty.className = 'layers-empty';
      empty.textContent = 'Brak warstw. Otwórz obraz lub dodaj warstwę.';
      list.append(empty);
      return;
    }
    for (const layer of layers) list.append(this.createLayerRow(layer));
  }

  createLayerRow(layer) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;
    row.dataset.active = String(layer.id === this.documentModel.activeLayerId);
    row.dataset.selected = String(this.documentModel.selectedLayerIds.includes(layer.id));
    row.dataset.locked = String(layer.locked);
    row.tabIndex = 0;
    row.addEventListener('click', event => {
      if (event.target.closest('button,input')) return;
      this.selectLayer(layer.id, event);
    });

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.className = 'layer-icon-button';
    visibility.title = layer.visible ? 'Ukryj warstwę' : 'Pokaż warstwę';
    visibility.setAttribute('aria-label', visibility.title);
    visibility.textContent = layer.visible ? '◉' : '○';
    visibility.addEventListener('click', () => this.execute(setLayerVisibilityCommand(layer.id, !layer.visible)));

    const thumbnail = document.createElement('span');
    thumbnail.className = `layer-thumbnail layer-thumbnail-${layer.type}`;
    thumbnail.textContent = ICONS[layer.type] ?? '?';
    thumbnail.title = `Typ: ${layer.type}`;

    const name = document.createElement('input');
    name.className = 'layer-name';
    name.value = layer.name;
    name.disabled = layer.locked;
    name.setAttribute('aria-label', 'Nazwa warstwy');
    name.addEventListener('focus', event => event.target.select());
    name.addEventListener('change', () => {
      if (name.value !== layer.name) this.execute(setLayerNameCommand(layer.id, name.value));
    });
    name.addEventListener('click', event => {
      event.stopPropagation();
      this.documentModel.setActiveLayer(layer.id);
      this.refreshProperties();
    });

    const lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'layer-icon-button';
    lock.title = layer.locked ? 'Odblokuj warstwę' : 'Zablokuj warstwę';
    lock.setAttribute('aria-label', lock.title);
    lock.textContent = layer.locked ? '▣' : '□';
    lock.addEventListener('click', () => this.execute(updateLayerCommand(layer.id, { locked: !layer.locked })));

    row.append(visibility, thumbnail, name, lock);
    return row;
  }

  refreshProperties() {
    const layer = this.documentModel.activeLayer;
    const e = this.elements;
    const hasLayer = Boolean(layer);
    if (e.selection) {
      const count = this.documentModel.selectedLayerIds.length;
      e.selection.textContent = count ? `${count} zaznaczon${count === 1 ? 'a warstwa' : 'e warstwy'}` : 'Brak zaznaczenia';
    }
    if (e.blend) {
      e.blend.disabled = !hasLayer || layer.locked;
      e.blend.value = layer?.blendMode ?? 'normal';
    }
    if (e.opacity) {
      e.opacity.disabled = !hasLayer || layer.locked;
      e.opacity.value = Math.round((layer?.opacity ?? 1) * 100);
    }
    if (e.opacityOutput) e.opacityOutput.textContent = `${Math.round((layer?.opacity ?? 1) * 100)}%`;
    if (e.duplicate) e.duplicate.disabled = !hasLayer;
    if (e.remove) e.remove.disabled = !hasLayer;
    const index = hasLayer ? this.documentModel.getLayerIndex(layer.id) : -1;
    if (e.up) e.up.disabled = index < 0 || index >= this.documentModel.layers.length - 1;
    if (e.down) e.down.disabled = index <= 0;
  }

  refreshHistory() {
    const { undo, redo } = this.elements;
    if (undo) {
      undo.disabled = !this.history.canUndo;
      undo.title = this.history.canUndo ? `Cofnij: ${this.history.undoStack.at(-1).label}` : 'Brak operacji do cofnięcia';
    }
    if (redo) {
      redo.disabled = !this.history.canRedo;
      redo.title = this.history.canRedo ? `Ponów: ${this.history.redoStack.at(-1).label}` : 'Brak operacji do ponowienia';
    }
  }
}

function isEditable(target) {
  return target?.matches?.('input, textarea, select, [contenteditable="true"]');
}
