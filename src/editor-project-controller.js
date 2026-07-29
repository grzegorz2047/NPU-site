import { createId } from './editor-document.js';
import { collectDocumentAssets, restoreDocumentAssets } from './editor-project-assets.js';
import {
  createProjectRecord,
  parsePortableProject,
  projectFilename,
  PROJECT_MIME_TYPE,
  stringifyPortableProject,
  UnsupportedProjectVersionError
} from './editor-project-format.js';
import { IndexedDbProjectStore } from './editor-project-store.js';

const LAST_PROJECT_KEY = 'localstudio:last-project';

export class ProjectController {
  constructor(options) {
    this.documentModel = options.documentModel;
    this.history = options.history;
    this.renderer = options.renderer;
    this.store = options.store ?? new IndexedDbProjectStore();
    this.root = options.root ?? document;
    this.storage = options.storage ?? globalThis.localStorage;
    this.debounceMs = Math.max(100, Number(options.debounceMs ?? 900));
    this.settingsProvider = options.settingsProvider ?? (() => ({}));
    this.settingsRestorer = options.settingsRestorer ?? (() => {});
    this.onProjectLoaded = options.onProjectLoaded ?? (() => {});
    this.onProjectCleared = options.onProjectCleared ?? (() => {});
    this.projectId = this.documentModel.id;
    this.dirty = false;
    this.suspended = true;
    this.saveTimer = null;
    this.savePromise = null;
    this.resaveRequested = false;
    this.changeRevision = 0;
    this.destroyed = false;
    this.statusElement = this.root.getElementById?.('project-save-status') ?? null;
    this.recentElement = this.root.getElementById?.('recent-projects') ?? null;
    this.projectInput = this.root.getElementById?.('project-file-input') ?? null;
    this.settingsChange = () => this.#handleChange('settings');
    this.root.addEventListener?.('localstudio:settings-change', this.settingsChange);
    this.unsubscribers = [
      this.documentModel.subscribe(event => this.#handleChange(event.type)),
      this.history.subscribe(state => this.#handleChange(`history:${state.type}`))
    ];
    this.beforeUnload = event => {
      if (!this.dirty && !this.savePromise) return;
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener?.('beforeunload', this.beforeUnload);
    this.#bindUi();
  }

  async initialize() {
    try {
      await this.store.open();
      await this.store.clearOrphanAssets();
      const recent = await this.store.listRecentProjects(10);
      const lastId = safeGet(this.storage, LAST_PROJECT_KEY);
      const candidate = lastId && recent.some(project => project.id === lastId) ? lastId : recent[0]?.id;
      if (candidate) await this.loadProject(candidate, { autosaveRecovery: true });
      else this.#setStatus('Gotowy do zapisu', 'neutral');
      await this.refreshRecentProjects();
    } catch (error) {
      this.#setStatus(this.#friendlyError(error), 'danger');
      console.error('Nie udało się zainicjalizować projektów LocalStudio.', error);
    } finally {
      this.suspended = false;
    }
    return this;
  }

  #handleChange(type) {
    if (this.suspended || this.destroyed) return;
    this.changeRevision += 1;
    this.dirty = true;
    this.#setStatus('Niezapisane zmiany', 'warning');
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow().catch(error => {
      this.#setStatus(this.#friendlyError(error), 'danger');
      console.error('Autosave LocalStudio nie powiódł się.', error);
    }), this.debounceMs);
  }

  async saveNow({ force = false } = {}) {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.savePromise) {
      this.resaveRequested = this.resaveRequested || this.dirty || force;
      return this.savePromise;
    }
    if (!this.dirty && !force) return null;
    const revision = this.changeRevision;
    this.#setStatus('Zapisywanie…', 'neutral');
    this.savePromise = this.#performSave(revision);
    try {
      const project = await this.savePromise;
      if (this.changeRevision === revision) this.dirty = false;
      else this.resaveRequested = true;
      this.#setStatus(`Zapisano ${formatTime(project.updatedAt)}`, 'success');
      await this.refreshRecentProjects();
      return project;
    } catch (error) {
      this.dirty = true;
      this.#setStatus(this.#friendlyError(error), 'danger');
      throw error;
    } finally {
      this.savePromise = null;
      if (this.resaveRequested) {
        this.resaveRequested = false;
        this.scheduleSave();
      }
    }
  }

  async #performSave() {
    await idleTurn();
    const documentSnapshot = this.documentModel.toJSON();
    const assets = await collectDocumentAssets(this.documentModel);
    const project = createProjectRecord({
      id: this.projectId || documentSnapshot.id,
      name: documentSnapshot.name,
      createdAt: documentSnapshot.createdAt,
      document: documentSnapshot,
      history: this.history.toJSON(),
      settings: this.settingsProvider(),
      assetIds: [...assets.keys()]
    });
    this.projectId = project.id;
    safeSet(this.storage, LAST_PROJECT_KEY, project.id);
    return this.store.saveProject(project, assets);
  }

  async loadProject(id, { autosaveRecovery = true } = {}) {
    if (this.dirty) await this.saveNow({ force: true });
    const loaded = await this.store.loadProject(id);
    if (!loaded) throw new Error('Nie znaleziono wybranego projektu.');
    this.suspended = true;
    try {
      this.documentModel.restore(loaded.project.document, { preserveRuntimeAssets: false });
      await restoreDocumentAssets(this.documentModel, loaded.assets);
      this.history.restore(loaded.project.history, { emit: false });
      this.settingsRestorer(loaded.project.settings ?? {});
      this.projectId = loaded.project.id;
      safeSet(this.storage, LAST_PROJECT_KEY, loaded.project.id);
      this.renderer.render(this.documentModel);
      this.dirty = false;
      this.onProjectLoaded({ ...loaded, documentModel: this.documentModel });
      if (loaded.recovered && autosaveRecovery) await this.store.commitRecovery(id);
      this.#setStatus(loaded.recovered ? 'Odzyskano po awarii' : `Otworzono ${formatTime(loaded.project.updatedAt)}`, loaded.recovered ? 'warning' : 'success');
    } finally {
      this.suspended = false;
    }
    await this.refreshRecentProjects();
    return loaded;
  }

  async newProject() {
    if (this.dirty) await this.saveNow({ force: true });
    this.suspended = true;
    try {
      const id = createId('document');
      this.documentModel.restore({ id, name: 'Bez nazwy', width: 640, height: 480, layers: [], activeLayerId: null, selectedLayerIds: [] }, { preserveRuntimeAssets: false });
      this.history.clear();
      this.projectId = id;
      this.dirty = false;
      safeSet(this.storage, LAST_PROJECT_KEY, id);
      this.renderer.render(this.documentModel);
      this.onProjectCleared({ documentModel: this.documentModel });
      this.#setStatus('Nowy projekt', 'neutral');
    } finally {
      this.suspended = false;
    }
  }

  async exportProject() {
    const project = await this.saveNow({ force: true });
    const current = project ?? createProjectRecord({
      id: this.projectId,
      document: this.documentModel.toJSON(),
      history: this.history.toJSON(),
      settings: this.settingsProvider()
    });
    const assets = await collectDocumentAssets(this.documentModel);
    const text = await stringifyPortableProject(current, assets);
    downloadBlob(new Blob([text], { type: PROJECT_MIME_TYPE }), projectFilename(current.name));
    this.#setStatus('Projekt wyeksportowany', 'success');
  }

  async importProject(source) {
    if (this.dirty) await this.saveNow({ force: true });
    this.#setStatus('Importowanie projektu…', 'neutral');
    const parsed = await parsePortableProject(source);
    const recent = await this.store.listRecentProjects(100);
    if (recent.some(item => item.id === parsed.project.id)) {
      const id = createId('document');
      parsed.project.id = id;
      parsed.project.document.id = id;
      parsed.project.name = `${parsed.project.name} — import`;
      parsed.project.document.name = parsed.project.name;
      parsed.project.updatedAt = new Date().toISOString();
    }
    await this.store.saveProject(parsed.project, parsed.assets);
    return this.loadProject(parsed.project.id, { autosaveRecovery: false });
  }

  async deleteProject(id) {
    if (id === this.projectId && this.dirty) await this.saveNow({ force: true });
    await this.store.deleteProject(id);
    if (id === this.projectId) await this.newProject();
    await this.refreshRecentProjects();
  }

  async refreshRecentProjects() {
    if (!this.recentElement) return;
    const projects = await this.store.listRecentProjects(8);
    this.recentElement.replaceChildren();
    if (!projects.length) {
      const empty = document.createElement('p');
      empty.className = 'recent-projects-empty';
      empty.textContent = 'Brak zapisanych projektów.';
      this.recentElement.append(empty);
      return;
    }
    for (const project of projects) this.recentElement.append(this.#recentProjectRow(project));
  }

  #recentProjectRow(project) {
    const row = document.createElement('div');
    row.className = 'recent-project-row';
    row.dataset.current = String(project.id === this.projectId);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-project-open';
    open.innerHTML = `<strong>${escapeHtml(project.name)}</strong><span>${project.recovered ? 'Do odzyskania · ' : ''}${escapeHtml(formatDate(project.updatedAt))}</span>`;
    open.addEventListener('click', () => this.loadProject(project.id).catch(error => this.#setStatus(this.#friendlyError(error), 'danger')));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-project-delete';
    remove.title = `Usuń projekt ${project.name}`;
    remove.setAttribute('aria-label', remove.title);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      if (globalThis.confirm?.(`Usunąć projekt „${project.name}” i wszystkie jego zasoby?`) === false) return;
      this.deleteProject(project.id).catch(error => this.#setStatus(this.#friendlyError(error), 'danger'));
    });
    row.append(open, remove);
    return row;
  }

  #bindUi() {
    bindClick(this.root, 'project-new', () => this.newProject());
    bindClick(this.root, 'project-save', () => this.saveNow({ force: true }));
    bindClick(this.root, 'project-export', () => this.exportProject());
    bindClick(this.root, 'project-import', () => this.projectInput?.click());
    this.projectInput?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      this.importProject(file).catch(error => this.#setStatus(this.#friendlyError(error), 'danger'));
    });
  }

  #setStatus(message, tone = 'neutral') {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.dataset.tone = tone;
    this.statusElement.title = message;
  }

  #friendlyError(error) {
    if (error instanceof UnsupportedProjectVersionError) return error.message;
    return error?.message ? `Błąd zapisu: ${error.message}` : 'Błąd zapisu projektu.';
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.root.removeEventListener?.('localstudio:settings-change', this.settingsChange);
    globalThis.removeEventListener?.('beforeunload', this.beforeUnload);
  }
}

function bindClick(root, id, action) {
  root.getElementById?.(id)?.addEventListener('click', () => Promise.resolve(action()).catch(error => console.error(error)));
}
function idleTurn() {
  return new Promise(resolve => {
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 0);
  });
}
function downloadBlob(blob, filename) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch {}
}
function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Nieznana data' : date.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
