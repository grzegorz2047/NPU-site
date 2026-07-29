import { DepthEngine } from './editor-depth-engine.js';
import { DepthController } from './editor-depth-ui.js';

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  const inference = globalThis.localStudioInference;
  if (!editor?.document || !editor?.history || !editor?.renderer || !editor?.canvasController || !editor?.toolsController || !inference?.runtime) {
    if (attempt < 240) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  const engine = new DepthEngine({ inferenceEngine: inference });
  const controller = new DepthController({ documentModel: editor.document, history: editor.history, renderer: editor.renderer, canvasController: editor.canvasController, toolsController: editor.toolsController, root: document, engine });
  globalThis.localStudioDepth = Object.freeze({ engine, controller });
}
if (typeof document !== 'undefined') start();
