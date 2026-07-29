import { SmartSelectEngine } from './editor-smart-select-engine.js';
import { SmartSelectController } from './editor-smart-select-ui.js';

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  const inference = globalThis.localStudioInference;
  if (!editor?.document || !editor?.history || !editor?.renderer || !editor?.canvasController || !editor?.toolsController || !inference?.runtime) {
    if (attempt < 240) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  const engine = new SmartSelectEngine({ inferenceEngine: inference });
  const controller = new SmartSelectController({
    documentModel: editor.document,
    history: editor.history,
    renderer: editor.renderer,
    canvasController: editor.canvasController,
    toolsController: editor.toolsController,
    root: document,
    engine
  });
  globalThis.localStudioSmartSelect = Object.freeze({ engine, controller });
}

if (typeof document !== 'undefined') start();
