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
  await loadExtension('./editor-retouch-bootstrap.js', 'retuszu');
  await loadExtension('./editor-smart-select-bootstrap.js', 'Smart Select');
  await loadExtension('./editor-depth-bootstrap.js', 'głębi');
  await loadExtension('./editor-restoration-bootstrap.js', 'restoration');
}

async function loadExtension(path, label) {
  try {
    await import(path);
  } catch (error) {
    console.error(`Nie udało się uruchomić modułu ${label}.`, error);
  }
}

if (typeof document !== 'undefined') start();
