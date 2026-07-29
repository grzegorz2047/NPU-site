import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { createProjectRecord } from '../src/editor-project-format.js';
import { assetKey, MemoryProjectStore } from '../src/editor-project-store.js';

function record(assetIds = ['a', 'b'], updatedAt = '2026-07-29T12:00:00.000Z') {
  const documentModel = createEditorDocument({
    id: 'project-1', width: 100, height: 100, name: 'Projekt',
    layers: assetIds.map((assetId, index) => createRasterLayer({ id: `layer-${index}`, assetId }))
  });
  return createProjectRecord({ id: 'project-1', document: documentModel.toJSON(), assetIds, updatedAt });
}

const blobs = ids => new Map(ids.map(id => [id, new Blob([id], { type: 'image/png' })]));

test('memory store round-trips projects and binary assets', async () => {
  const store = new MemoryProjectStore();
  await store.saveProject(record(), blobs(['a', 'b']));
  const loaded = await store.loadProject('project-1');
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.project.name, 'Projekt');
  assert.deepEqual([...loaded.assets.keys()], ['a', 'b']);
  assert.equal(await loaded.assets.get('a').text(), 'a');
});

test('updating a project removes assets that are no longer referenced', async () => {
  const store = new MemoryProjectStore();
  await store.saveProject(record(), blobs(['a', 'b']));
  await store.saveProject(record(['a'], '2026-07-29T13:00:00.000Z'), blobs(['a']));
  assert.equal(store.assets.has(assetKey('project-1', 'a')), true);
  assert.equal(store.assets.has(assetKey('project-1', 'b')), false);
});

test('deleting a project removes all owned assets and recovery data', async () => {
  const store = new MemoryProjectStore();
  const project = record();
  await store.saveProject(project, blobs(['a', 'b']));
  store.injectRecovery(project, blobs(['a', 'b']));
  store.assets.set('project-1:stale', { key: 'project-1:stale', projectId: 'project-1', assetId: 'stale', blob: new Blob(['stale']) });
  await store.deleteProject('project-1');
  assert.equal(store.projects.size, 0);
  assert.equal(store.assets.size, 0);
  assert.equal(store.recovery.size, 0);
});

test('loads a newer recovery snapshot after an interrupted save and commits it', async () => {
  const store = new MemoryProjectStore();
  await store.saveProject(record(['a'], '2026-07-29T12:00:00.000Z'), blobs(['a']));
  const recoveredProject = record(['a', 'c'], '2026-07-29T13:00:00.000Z');
  store.injectRecovery(recoveredProject, blobs(['a', 'c']), '2026-07-29T13:00:01.000Z');

  const loaded = await store.loadProject('project-1');
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.project.assetIds, ['a', 'c']);
  assert.equal(await store.commitRecovery('project-1'), true);
  const committed = await store.loadProject('project-1');
  assert.equal(committed.recovered, false);
  assert.deepEqual(committed.project.assetIds, ['a', 'c']);
});

test('orphan cleanup removes binary records not owned by any project', async () => {
  const store = new MemoryProjectStore();
  await store.saveProject(record(['a']), blobs(['a']));
  store.assets.set('ghost:orphan', { key: 'ghost:orphan', projectId: 'ghost', assetId: 'orphan', blob: new Blob(['x']) });
  assert.equal(await store.clearOrphanAssets(), 1);
  assert.equal(store.assets.has('ghost:orphan'), false);
  assert.equal(store.assets.has(assetKey('project-1', 'a')), true);
});
