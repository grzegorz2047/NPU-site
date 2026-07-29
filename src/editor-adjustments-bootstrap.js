import { installAdjustmentRendering } from './editor-adjustment-renderer.js';
import { AdjustmentPanel } from './editor-adjustments-ui.js';

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  if (!editor?.document || !editor?.history || !editor?.renderer) {
    if (attempt < 160) setTimeout(() => start(attempt + 1), 25);
    return;
  }
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

if (typeof document !== 'undefined') start();
