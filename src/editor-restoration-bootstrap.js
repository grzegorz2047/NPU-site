import { RestorationEngine } from './editor-restoration-engine.js';
import { RestorationController } from './editor-restoration-ui.js';

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  const inference = globalThis.localStudioInference;
  if (!editor?.document || !editor?.history || !editor?.renderer || !inference?.runtime) {
    if (attempt < 240) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  if (globalThis.localStudioRestoration) return;
  const engine = new RestorationEngine({ inferenceEngine: inference });
  const controller = new RestorationController({
    documentModel: editor.document,
    history: editor.history,
    renderer: editor.renderer,
    root: document,
    engine
  });
  globalThis.localStudioRestoration = Object.freeze({ engine, controller });
}

if (typeof document !== 'undefined') start();
