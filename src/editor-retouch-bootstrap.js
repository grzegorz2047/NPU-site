import { installRetouchRendering } from './editor-retouch-renderer.js';
import { RetouchController } from './editor-retouch-ui.js';

export function createRetouchCanvasControllerAdapter(canvasController) {
  if (!canvasController || typeof canvasController.eventDocumentPoint !== 'function') {
    throw new Error('Retusz wymaga CanvasController.eventDocumentPoint().');
  }
  return new Proxy(canvasController, {
    get(target, property, receiver) {
      if (property !== 'viewport') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const viewport = target.viewport ?? {};
      return new Proxy(viewport, {
        get(viewportTarget, viewportProperty, viewportReceiver) {
          if (viewportProperty === 'clientToDocument') {
            return (clientX, clientY) => target.eventDocumentPoint({ clientX, clientY });
          }
          return Reflect.get(viewportTarget, viewportProperty, viewportReceiver);
        }
      });
    }
  });
}

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
    canvasController: createRetouchCanvasControllerAdapter(editor.canvasController),
    toolsController: editor.toolsController,
    root: document
  });
  editor.renderer.render(editor.document);
  globalThis.localStudioRetouch = Object.freeze({ controller, integration });
}

if (typeof document !== 'undefined') start();
