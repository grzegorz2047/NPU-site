import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyInspectorSection, inspectorTabForControl, normalizeInspectorTab } from '../src/editor-inspector-nav.js';

function section({ id = '', className = '', summary = '' } = {}) {
  return {
    id,
    className,
    classList: className.split(/\s+/).filter(Boolean),
    querySelector(selector) { return selector.includes('summary') ? { textContent: summary } : null; }
  };
}

function control({ id = '', className = '', dataset = {} } = {}) {
  return { id, className, classList: className.split(/\s+/).filter(Boolean), dataset };
}

test('normalizes unsupported inspector tabs to layers', () => {
  assert.equal(normalizeInspectorTab('ai'), 'ai');
  assert.equal(normalizeInspectorTab('unknown'), 'layers');
});

test('classifies inspector sections by user intent', () => {
  assert.equal(classifyInspectorSection(section({ className: 'inspector-section layers-section', summary: 'Warstwy' })), 'layers');
  assert.equal(classifyInspectorSection(section({ id: 'adjustments-panel', summary: 'Korekty niedestrukcyjne' })), 'layers');
  assert.equal(classifyInspectorSection(section({ id: 'manual-tool-panel', summary: 'Narzędzia manualne' })), 'tool');
  assert.equal(classifyInspectorSection(section({ id: 'retouch-panel', summary: 'Retusz lokalny' })), 'tool');
  assert.equal(classifyInspectorSection(section({ id: 'smart-select-panel', summary: 'Smart Select' })), 'ai');
  assert.equal(classifyInspectorSection(section({ summary: 'AI i dokument' })), 'ai');
  assert.equal(classifyInspectorSection(section({ className: 'project-section', summary: 'Projekty lokalne' })), 'document');
  assert.equal(classifyInspectorSection(section({ summary: 'Eksport' })), 'document');
  assert.equal(classifyInspectorSection(section({ summary: 'Tło i kompozycja' })), 'tool');
});

test('maps commands to the tab that contains their controls', () => {
  assert.equal(inspectorTabForControl(control({ dataset: { manualTool: 'brush' } })), 'tool');
  assert.equal(inspectorTabForControl(control({ id: 'smart-select-tool' })), 'ai');
  assert.equal(inspectorTabForControl(control({ className: 'layer-row' })), 'layers');
  assert.equal(inspectorTabForControl(control({ id: 'project-save' })), 'document');
  assert.equal(inspectorTabForControl(control({ id: 'unrelated' })), null);
});
