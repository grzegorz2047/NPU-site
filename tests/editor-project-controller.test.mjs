import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { CommandHistory, setLayerNameCommand } from '../src/editor-history.js';
import { ProjectController } from '../src/editor-project-controller.js';
import { MemoryProjectStore } from '../src/editor-project-store.js';

class RootStub extends EventTarget {
  getElementById() { return null; }
}

class StorageStub {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function workspace() {
  const documentModel = createEditorDocument({
    id: 'project-refresh',
    width: 64,
    height: 48,
    name: 'Projekt po odświeżeniu',
    layers: [createRasterLayer({ id: 'base', assetId: 'asset-1', width: 64, height: 48 })]
  });
  documentModel.setRuntimeAsset('asset-1', new Blob(['pixels'], { type: 'application/octet-stream' }));
  return { documentModel, history: new CommandHistory(), renderer: { renders: 0, render() { this.renders += 1; } } };
}

test('controller autosave restores document, history, settings and assets after refresh', async () => {
  const store = new MemoryProjectStore();
  const storage = new StorageStub();
  const first = workspace();
  const controller = new ProjectController({
    ...first,
    store,
    storage,
    root: new RootStub(),
    debounceMs: 100,
    settingsProvider: () => ({ quality: 88 })
  });
  await controller.initialize();
  first.history.execute(setLayerNameCommand('base', 'Warstwa zapisana'), first.documentModel);
  await controller.saveNow({ force: true });
  controller.destroy();

  const second = {
    documentModel: createEditorDocument({ width: 1, height: 1 }),
    history: new CommandHistory(),
    renderer: { renders: 0, render() { this.renders += 1; } }
  };
  let restoredSettings = null;
  const refreshed = new ProjectController({
    ...second,
    store,
    storage,
    root: new RootStub(),
    settingsRestorer: settings => { restoredSettings = settings; }
  });
  await refreshed.initialize();

  assert.equal(second.documentModel.id, 'project-refresh');
  assert.equal(second.documentModel.getLayer('base').name, 'Warstwa zapisana');
  assert.equal(await second.documentModel.getRuntimeAsset('asset-1').text(), 'pixels');
  assert.equal(second.history.canUndo, true);
  assert.deepEqual(restoredSettings, { quality: 88 });
  assert.ok(second.renderer.renders > 0);
  refreshed.destroy();
});
