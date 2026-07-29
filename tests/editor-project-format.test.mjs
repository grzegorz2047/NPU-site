import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocument, createRasterLayer } from '../src/editor-document.js';
import { CommandHistory, setLayerNameCommand } from '../src/editor-history.js';
import {
  buildPortableProject,
  createProjectRecord,
  migrateProjectRecord,
  parsePortableProject,
  PROJECT_SCHEMA_VERSION,
  referencedAssetIds,
  stringifyPortableProject,
  UnsupportedProjectVersionError
} from '../src/editor-project-format.js';

function fixture() {
  const documentModel = createEditorDocument({
    id: 'project-1',
    width: 320,
    height: 240,
    name: 'Portret',
    metadata: { legacySourceAssetId: 'source-1' },
    layers: [createRasterLayer({ id: 'base', assetId: 'asset-1', width: 320, height: 240, mask: { assetId: 'mask-1' } })]
  });
  const history = new CommandHistory();
  history.execute(setLayerNameCommand('base', 'Tło'), documentModel);
  return { documentModel, history };
}

test('portable project round-trips document, history, settings and binary assets', async () => {
  const { documentModel, history } = fixture();
  const assets = new Map([
    ['asset-1', new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' })],
    ['mask-1', new Blob([Uint8Array.from([4, 5])], { type: 'image/png' })],
    ['source-1', new Blob([Uint8Array.from([6, 7, 8, 9])], { type: 'image/png' })]
  ]);
  const record = createProjectRecord({ document: documentModel.toJSON(), history: history.toJSON(), settings: { quality: 92 } });
  const text = await stringifyPortableProject(record, assets);
  const parsed = await parsePortableProject(text);

  assert.equal(parsed.project.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(parsed.project.document.layers[0].name, 'Tło');
  assert.equal(parsed.project.history.undo.length, 1);
  assert.deepEqual(parsed.project.settings, { quality: 92 });
  assert.deepEqual([...parsed.assets.keys()].sort(), ['asset-1', 'mask-1', 'source-1']);
  assert.deepEqual([...new Uint8Array(await parsed.assets.get('source-1').arrayBuffer())], [6, 7, 8, 9]);
});

test('collects raster, mask, nested and legacy source asset ids without duplicates', () => {
  const { documentModel } = fixture();
  documentModel.layers.push({
    id: 'group', name: 'Group', type: 'group', visible: true, locked: false, opacity: 1, blendMode: 'normal', transform: {}, clipping: {}, metadata: {}, content: {},
    children: [createRasterLayer({ id: 'nested', assetId: 'asset-1' })]
  });
  assert.deepEqual(referencedAssetIds(documentModel.toJSON()).sort(), ['asset-1', 'mask-1', 'source-1']);
});

test('migrates legacy schema version zero', () => {
  const migrated = migrateProjectRecord({
    version: 0,
    id: 'legacy',
    name: 'Stary projekt',
    snapshot: { id: 'legacy', name: 'Stary projekt', width: 10, height: 20, layers: [createRasterLayer({ assetId: 'old-asset' })] },
    settings: { brightness: 110 }
  });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.document.width, 10);
  assert.deepEqual(migrated.assetIds, ['old-asset']);
  assert.deepEqual(migrated.settings, { brightness: 110 });
});

test('rejects projects created by a newer incompatible version', async () => {
  assert.throws(() => migrateProjectRecord({ schemaVersion: 99 }), UnsupportedProjectVersionError);
  await assert.rejects(
    () => parsePortableProject(JSON.stringify({ format: 'localstudio', schemaVersion: 99, project: {}, assets: [] })),
    UnsupportedProjectVersionError
  );
});

test('portable build rejects a missing referenced asset', async () => {
  const { documentModel } = fixture();
  const record = createProjectRecord({ document: documentModel.toJSON() });
  await assert.rejects(() => buildPortableProject(record, new Map()), /Brakuje zasobu projektu/);
});
