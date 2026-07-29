import { validateProjectRecord } from './editor-project-format.js';

export const PROJECT_DB_NAME = 'localstudio-projects';
export const PROJECT_DB_VERSION = 1;

export class IndexedDbProjectStore {
  constructor({ indexedDB = globalThis.indexedDB, dbName = PROJECT_DB_NAME } = {}) {
    if (!indexedDB) throw new Error('IndexedDB nie jest dostępne w tej przeglądarce.');
    this.indexedDB = indexedDB;
    this.dbName = dbName;
    this.dbPromise = null;
  }

  open() {
    if (!this.dbPromise) this.dbPromise = openDatabase(this.indexedDB, this.dbName);
    return this.dbPromise;
  }

  async saveProject(projectInput, assetsInput = new Map()) {
    const project = validateProjectRecord(projectInput);
    const assets = normalizeAssets(project, assetsInput);
    const recovery = createRecoveryRecord(project, assets);
    const db = await this.open();

    await withTransaction(db, ['recovery'], 'readwrite', stores => request(stores.recovery.put(recovery)));
    await this.#commitProject(db, project, assets);
    await withTransaction(db, ['recovery'], 'readwrite', stores => request(stores.recovery.delete(project.id)));
    return project;
  }

  async #commitProject(db, project, assets) {
    await withTransaction(db, ['projects', 'assets'], 'readwrite', async stores => {
      const previous = await request(stores.projects.get(project.id));
      const nextAssetIds = new Set(project.assetIds);
      for (const [assetId, blob] of assets) {
        await request(stores.assets.put(createAssetRecord(project.id, assetId, blob, project.updatedAt)));
      }
      for (const assetId of previous?.assetIds ?? []) {
        if (!nextAssetIds.has(assetId)) await request(stores.assets.delete(assetKey(project.id, assetId)));
      }
      await request(stores.projects.put(project));
    });
  }

  async loadProject(id) {
    const db = await this.open();
    const [project, recovery] = await Promise.all([
      withTransaction(db, ['projects'], 'readonly', stores => request(stores.projects.get(id))),
      withTransaction(db, ['recovery'], 'readonly', stores => request(stores.recovery.get(id)))
    ]);
    const useRecovery = recovery && (!project || Date.parse(recovery.savedAt) > Date.parse(project.updatedAt));
    if (useRecovery) return { project: validateProjectRecord(recovery.project), assets: new Map(recovery.assets.map(item => [item.assetId, item.blob])), recovered: true };
    if (!project) return null;
    const assets = await this.#loadAssets(db, project);
    return { project: validateProjectRecord(project), assets, recovered: false };
  }

  async #loadAssets(db, project) {
    return withTransaction(db, ['assets'], 'readonly', async stores => {
      const assets = new Map();
      for (const assetId of project.assetIds) {
        const record = await request(stores.assets.get(assetKey(project.id, assetId)));
        if (!record?.blob) throw new Error(`Projekt ${project.name} ma brakujący zasób ${assetId}.`);
        assets.set(assetId, record.blob);
      }
      return assets;
    });
  }

  async commitRecovery(id) {
    const db = await this.open();
    const recovery = await withTransaction(db, ['recovery'], 'readonly', stores => request(stores.recovery.get(id)));
    if (!recovery) return false;
    const project = validateProjectRecord(recovery.project);
    const assets = new Map(recovery.assets.map(item => [item.assetId, item.blob]));
    await this.#commitProject(db, project, assets);
    await withTransaction(db, ['recovery'], 'readwrite', stores => request(stores.recovery.delete(id)));
    return true;
  }

  async listRecentProjects(limit = 8) {
    const db = await this.open();
    const [projects, recoveries] = await Promise.all([
      withTransaction(db, ['projects'], 'readonly', stores => request(stores.projects.getAll())),
      withTransaction(db, ['recovery'], 'readonly', stores => request(stores.recovery.getAll()))
    ]);
    return mergeRecent(projects, recoveries).slice(0, normalizeLimit(limit));
  }

  async deleteProject(id) {
    const db = await this.open();
    await withTransaction(db, ['projects', 'assets', 'recovery'], 'readwrite', async stores => {
      const assetKeys = await request(stores.assets.index('projectId').getAllKeys(id));
      for (const key of assetKeys) await request(stores.assets.delete(key));
      await request(stores.projects.delete(id));
      await request(stores.recovery.delete(id));
    });
  }

  async clearOrphanAssets() {
    const db = await this.open();
    return withTransaction(db, ['projects', 'assets'], 'readwrite', async stores => {
      const [projects, assets] = await Promise.all([request(stores.projects.getAll()), request(stores.assets.getAll())]);
      const referenced = new Set(projects.flatMap(project => (project.assetIds ?? []).map(assetId => assetKey(project.id, assetId))));
      let removed = 0;
      for (const asset of assets) {
        if (!referenced.has(asset.key)) {
          await request(stores.assets.delete(asset.key));
          removed += 1;
        }
      }
      return removed;
    });
  }

  async close() {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}

export class MemoryProjectStore {
  constructor() {
    this.projects = new Map();
    this.assets = new Map();
    this.recovery = new Map();
  }

  async open() { return this; }

  async saveProject(projectInput, assetsInput = new Map()) {
    const project = validateProjectRecord(projectInput);
    const assets = normalizeAssets(project, assetsInput);
    this.recovery.set(project.id, createRecoveryRecord(project, assets));
    const previous = this.projects.get(project.id);
    const nextAssetIds = new Set(project.assetIds);
    for (const [assetId, blob] of assets) this.assets.set(assetKey(project.id, assetId), createAssetRecord(project.id, assetId, blob, project.updatedAt));
    for (const assetId of previous?.assetIds ?? []) if (!nextAssetIds.has(assetId)) this.assets.delete(assetKey(project.id, assetId));
    this.projects.set(project.id, cloneRecord(project));
    this.recovery.delete(project.id);
    return cloneRecord(project);
  }

  async loadProject(id) {
    const project = this.projects.get(id);
    const recovery = this.recovery.get(id);
    const useRecovery = recovery && (!project || Date.parse(recovery.savedAt) > Date.parse(project.updatedAt));
    if (useRecovery) return {
      project: validateProjectRecord(recovery.project),
      assets: new Map(recovery.assets.map(item => [item.assetId, item.blob])),
      recovered: true
    };
    if (!project) return null;
    const assets = new Map();
    for (const assetId of project.assetIds) {
      const asset = this.assets.get(assetKey(id, assetId));
      if (!asset) throw new Error(`Projekt ${project.name} ma brakujący zasób ${assetId}.`);
      assets.set(assetId, asset.blob);
    }
    return { project: validateProjectRecord(project), assets, recovered: false };
  }

  async commitRecovery(id) {
    const recovery = this.recovery.get(id);
    if (!recovery) return false;
    const project = validateProjectRecord(recovery.project);
    const assets = new Map(recovery.assets.map(item => [item.assetId, item.blob]));
    const previous = this.projects.get(id);
    const nextAssetIds = new Set(project.assetIds);
    for (const [assetId, blob] of assets) this.assets.set(assetKey(id, assetId), createAssetRecord(id, assetId, blob, project.updatedAt));
    for (const assetId of previous?.assetIds ?? []) if (!nextAssetIds.has(assetId)) this.assets.delete(assetKey(id, assetId));
    this.projects.set(id, cloneRecord(project));
    this.recovery.delete(id);
    return true;
  }

  async listRecentProjects(limit = 8) {
    return mergeRecent([...this.projects.values()], [...this.recovery.values()]).slice(0, normalizeLimit(limit));
  }

  async deleteProject(id) {
    for (const [key, asset] of [...this.assets]) if (asset.projectId === id || key.startsWith(`${id}:`)) this.assets.delete(key);
    this.projects.delete(id);
    this.recovery.delete(id);
  }

  async clearOrphanAssets() {
    const referenced = new Set([...this.projects.values()].flatMap(project => project.assetIds.map(assetId => assetKey(project.id, assetId))));
    let removed = 0;
    for (const key of [...this.assets.keys()]) {
      if (!referenced.has(key)) {
        this.assets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  injectRecovery(projectInput, assetsInput = new Map(), savedAt = new Date(Date.now() + 1000).toISOString()) {
    const project = validateProjectRecord(projectInput);
    const assets = normalizeAssets(project, assetsInput);
    this.recovery.set(project.id, createRecoveryRecord(project, assets, savedAt));
  }
}

export function assetKey(projectId, assetId) { return `${projectId}:${assetId}`; }

function openDatabase(indexedDB, dbName) {
  return new Promise((resolve, reject) => {
    const requestHandle = indexedDB.open(dbName, PROJECT_DB_VERSION);
    requestHandle.onupgradeneeded = () => {
      const db = requestHandle.result;
      if (!db.objectStoreNames.contains('projects')) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('assets')) {
        const assets = db.createObjectStore('assets', { keyPath: 'key' });
        assets.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('recovery')) {
        const recovery = db.createObjectStore('recovery', { keyPath: 'id' });
        recovery.createIndex('savedAt', 'savedAt');
      }
    };
    requestHandle.onerror = () => reject(requestHandle.error ?? new Error('Nie udało się otworzyć IndexedDB.'));
    requestHandle.onblocked = () => reject(new Error('Baza projektów jest zablokowana przez inną kartę.'));
    requestHandle.onsuccess = () => resolve(requestHandle.result);
  });
}

function withTransaction(db, storeNames, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)]));
    let result;
    let operationError = null;
    Promise.resolve()
      .then(() => operation(stores, transaction))
      .then(value => { result = value; })
      .catch(error => {
        operationError = error;
        try { transaction.abort(); } catch {}
      });
    transaction.oncomplete = () => operationError ? reject(operationError) : resolve(result);
    transaction.onerror = () => reject(operationError ?? transaction.error ?? new Error('Operacja IndexedDB nie powiodła się.'));
    transaction.onabort = () => reject(operationError ?? transaction.error ?? new Error('Operacja IndexedDB została przerwana.'));
  });
}

function request(requestHandle) {
  return new Promise((resolve, reject) => {
    requestHandle.onsuccess = () => resolve(requestHandle.result);
    requestHandle.onerror = () => reject(requestHandle.error ?? new Error('Operacja IndexedDB nie powiodła się.'));
  });
}

function normalizeAssets(project, assetsInput) {
  const assets = assetsInput instanceof Map ? new Map(assetsInput) : new Map(Object.entries(assetsInput ?? {}));
  for (const assetId of project.assetIds) {
    const blob = assets.get(assetId);
    if (!(blob instanceof Blob)) throw new Error(`Brakuje trwałego zasobu ${assetId}.`);
  }
  return new Map(project.assetIds.map(assetId => [assetId, assets.get(assetId)]));
}
function createAssetRecord(projectId, assetId, blob, updatedAt) {
  return { key: assetKey(projectId, assetId), projectId, assetId, blob, updatedAt };
}
function createRecoveryRecord(project, assets, savedAt = new Date().toISOString()) {
  return {
    id: project.id,
    savedAt,
    project: cloneRecord(project),
    assets: [...assets].map(([assetId, blob]) => ({ assetId, blob }))
  };
}
function mergeRecent(projects, recoveries) {
  const byId = new Map(projects.map(project => [project.id, { ...cloneRecord(project), recovered: false }]));
  for (const recovery of recoveries) {
    const current = byId.get(recovery.id);
    if (!current || Date.parse(recovery.savedAt) > Date.parse(current.updatedAt)) {
      byId.set(recovery.id, { ...cloneRecord(recovery.project), updatedAt: recovery.savedAt, recovered: true });
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
function normalizeLimit(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 8;
}
function cloneRecord(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
