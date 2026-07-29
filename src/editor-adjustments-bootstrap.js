import { installAdjustmentRendering } from './editor-adjustment-renderer.js';
import { AdjustmentPanel } from './editor-adjustments-ui.js';

async function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  if (!editor?.document || !editor?.history || !editor?.renderer) {
    if (attempt < 160) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  if (!globalThis.localStudioAdjustments) {
    const integration = installAdjustmentRendering(editor.renderer);
    const panel = new AdjustmentPanel({
      documentModel: editor.document,
      history: editor.history,
      renderer: editor.renderer,
      root: document
    });
    editor.renderer.render(editor.document);
    globalThis.localStudioAdjustments = Object.freeze({
      panel,
      integration,
      render: options => editor.renderer.render(editor.document, options),
      before: () => editor.renderer.render(editor.document, { includeAdjustments: false })
    });
  }
  await loadExtension('./editor-retouch-bootstrap.js', 'retuszu', 'localStudioRetouch');
  await loadExtension('./editor-smart-select-bootstrap.js', 'Smart Select', 'localStudioSmartSelect');
  await loadExtension('./editor-depth-bootstrap.js', 'głębi', 'localStudioDepth');
  await loadExtension('./editor-restoration-bootstrap.js', 'restoration', 'localStudioRestoration');
  await installInspector();
}

async function loadExtension(path, label, globalKey) {
  try {
    await import(path);
    await waitForGlobal(globalKey);
  } catch (error) {
    console.error(`Nie udało się uruchomić modułu ${label}.`, error);
  }
}

async function installInspector() {
  try {
    const { installInspectorNavigation } = await import('./editor-inspector-nav.js');
    installInspectorNavigation(document);
  } catch (error) {
    console.error('Nie udało się uruchomić nawigacji panelu bocznego.', error);
  }
}

async function waitForGlobal(key, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (globalThis[key]) return globalThis[key];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Moduł ${key} nie zakończył inicjalizacji.`);
}

if (typeof document !== 'undefined') start();
