import { installRetouchRendering } from './editor-retouch-renderer.js';
import { RetouchController } from './editor-retouch-ui.js';

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  if (!editor?.document || !editor?.history || !editor?.renderer || !editor?.canvasController || !editor?.toolsController) {
    if (attempt < 160) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  const integration = installRetouchRendering(editor.renderer);
  const controller = new RetouchController({
    documentModel: editor.document,
    history: editor.history,
    renderer: editor.renderer,
    canvasController: editor.canvasController,
    toolsController: editor.toolsController,
    root: document
  });
  editor.renderer.render(editor.document);
  globalThis.localStudioRetouch = Object.freeze({ controller, integration });
}

if (typeof document !== 'undefined') start();
