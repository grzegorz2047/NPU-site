import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocument, createGroupLayer, createRasterLayer } from '../src/editor-document.js';
import {
  addLayerCommand,
  CommandHistory,
  duplicateLayerCommand,
  moveLayerCommand,
  removeLayerCommand,
  setLayerNameCommand,
  setLayerOpacityCommand,
  setLayerTransformCommand,
  setLayerVisibilityCommand,
  updateLayerCommand
} from '../src/editor-history.js';

function fixture(limit = 100) {
  const documentModel = createEditorDocument({ width: 100, height: 100, layers: [createRasterLayer({ id: 'base', name: 'Base' })] });
  documentModel.setActiveLayer('base');
  return { documentModel, history: new CommandHistory({ limit }) };
}

test('undoes and redoes layer addition and removal', () => {
  const { documentModel, history } = fixture();
  history.execute(addLayerCommand(createRasterLayer({ id: 'top', name: 'Top' })), documentModel);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base', 'top']);
  assert.equal(history.undo(documentModel), true);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base']);
  assert.equal(history.redo(documentModel), true);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base', 'top']);

  history.execute(removeLayerCommand('top'), documentModel);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base']);
  history.undo(documentModel);
  assert.deepEqual(documentModel.layers.map(layer => layer.id), ['base', 'top']);
});

test('tracks duplicate and layer order commands', () => {
  const { documentModel, history } = fixture();
  history.execute(duplicateLayerCommand('base'), documentModel);
  const duplicateId = documentModel.layers[1].id;
  assert.notEqual(duplicateId, 'base');
  history.execute(moveLayerCommand(duplicateId, 0), documentModel);
  assert.equal(documentModel.layers[0].id, duplicateId);
  history.undo(documentModel);
  assert.equal(documentModel.layers[1].id, duplicateId);
  history.undo(documentModel);
  assert.equal(documentModel.layers.length, 1);
});

test('tracks nested group operations without moving children to the root', () => {
  const documentModel = createEditorDocument({
    width: 100,
    height: 100,
    layers: [createGroupLayer({ id: 'group', children: [createRasterLayer({ id: 'a' }), createRasterLayer({ id: 'b' })] })]
  });
  const history = new CommandHistory();

  history.execute(addLayerCommand(createRasterLayer({ id: 'nested' }), 1, 'group'), documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), ['a', 'nested', 'b']);
  history.execute(duplicateLayerCommand('nested'), documentModel);
  const duplicateId = documentModel.getLayer('group').children[2].id;
  assert.equal(documentModel.layers.length, 1);
  history.execute(moveLayerCommand(duplicateId, 0), documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), [duplicateId, 'a', 'nested', 'b']);
  history.execute(removeLayerCommand('nested'), documentModel);
  assert.equal(documentModel.getLayer('nested'), null);

  history.undo(documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), [duplicateId, 'a', 'nested', 'b']);
  history.undo(documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), ['a', 'nested', duplicateId, 'b']);
  history.undo(documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), ['a', 'nested', 'b']);
  history.undo(documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), ['a', 'b']);
  history.redo(documentModel);
  assert.deepEqual(documentModel.getLayer('group').children.map(layer => layer.id), ['a', 'nested', 'b']);
});

test('tracks visibility, opacity, name, lock and transform changes', () => {
  const { documentModel, history } = fixture();
  history.execute(setLayerVisibilityCommand('base', false), documentModel);
  history.execute(setLayerOpacityCommand('base', 0.25), documentModel);
  history.execute(setLayerNameCommand('base', 'Portrait'), documentModel);
  history.execute(updateLayerCommand('base', { locked: true }), documentModel);
  history.execute(setLayerTransformCommand('base', { x: 10, y: 12, rotation: 15 }), documentModel);
  const layer = documentModel.getLayer('base');
  assert.equal(layer.visible, false);
  assert.equal(layer.opacity, 0.25);
  assert.equal(layer.name, 'Portrait');
  assert.equal(layer.locked, true);
  assert.equal(layer.transform.x, 10);
  history.undo(documentModel);
  assert.equal(documentModel.getLayer('base').transform.x, 0);
});

test('clears redo after a new operation', () => {
  const { documentModel, history } = fixture();
  history.execute(setLayerNameCommand('base', 'A'), documentModel);
  history.undo(documentModel);
  assert.equal(history.canRedo, true);
  history.execute(setLayerVisibilityCommand('base', false), documentModel);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(documentModel), false);
});

test('enforces history limit safely', () => {
  const { documentModel, history } = fixture(2);
  history.execute(setLayerNameCommand('base', 'A'), documentModel);
  history.execute(setLayerNameCommand('base', 'B'), documentModel);
  history.execute(setLayerNameCommand('base', 'C'), documentModel);
  assert.equal(history.undoStack.length, 2);
  history.undo(documentModel);
  assert.equal(documentModel.getLayer('base').name, 'B');
  history.undo(documentModel);
  assert.equal(documentModel.getLayer('base').name, 'A');
  assert.equal(history.undo(documentModel), false);
});

test('compacts repeated opacity changes into one undo entry', () => {
  const { documentModel, history } = fixture();
  history.execute(setLayerOpacityCommand('base', 0.8), documentModel);
  history.execute(setLayerOpacityCommand('base', 0.6), documentModel);
  history.execute(setLayerOpacityCommand('base', 0.4), documentModel);
  assert.equal(history.undoStack.length, 1);
  assert.equal(documentModel.getLayer('base').opacity, 0.4);
  history.undo(documentModel);
  assert.equal(documentModel.getLayer('base').opacity, 1);
  history.redo(documentModel);
  assert.equal(documentModel.getLayer('base').opacity, 0.4);
});

test('serializes and restores undo/redo snapshots', () => {
  const { documentModel, history } = fixture();
  history.execute(setLayerNameCommand('base', 'Portret'), documentModel);
  history.execute(setLayerVisibilityCommand('base', false), documentModel);
  history.undo(documentModel);
  const snapshot = JSON.parse(JSON.stringify(history));

  const restored = new CommandHistory();
  restored.restore(snapshot);
  assert.equal(restored.canUndo, true);
  assert.equal(restored.canRedo, true);
  assert.equal(restored.undoStack.at(-1).label, 'Zmień nazwę warstwy');
  assert.equal(restored.redoStack.at(-1).label, 'Ukryj warstwę');

  restored.redo(documentModel);
  assert.equal(documentModel.getLayer('base').visible, false);
  restored.undo(documentModel);
  assert.equal(documentModel.getLayer('base').visible, true);
});
