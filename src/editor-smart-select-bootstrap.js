import {
  SMART_DETECTION_MODEL_ID,
  SMART_SEGMENTATION_MODEL_ID,
  SMART_SELECT_MODELS,
  SmartSelectEngine
} from './editor-smart-select-engine.js';
import { SmartSelectController } from './editor-smart-select-ui.js';

export const VERIFIED_SMART_SELECT_REPOSITORIES = Object.freeze({
  [SMART_SEGMENTATION_MODEL_ID]: 'Xenova/segformer-b0-finetuned-ade-512-512',
  [SMART_DETECTION_MODEL_ID]: 'Xenova/detr-resnet-50'
});

export function installVerifiedSmartSelectModels(registry) {
  if (!registry?.replace) throw new Error('Smart Select wymaga zapisywalnego rejestru modeli.');
  for (const model of SMART_SELECT_MODELS) {
    const repository = VERIFIED_SMART_SELECT_REPOSITORIES[model.id];
    if (!repository) continue;
    registry.replace({
      ...model,
      repository,
      version: `xenova-main-2026-07-fix1-${model.id}`
    });
  }
  return registry;
}

function start(attempt = 0) {
  const editor = globalThis.localStudioEditor;
  const inference = globalThis.localStudioInference;
  if (!editor?.document || !editor?.history || !editor?.renderer || !editor?.canvasController || !editor?.toolsController || !inference?.runtime) {
    if (attempt < 240) setTimeout(() => start(attempt + 1), 25);
    return;
  }
  installVerifiedSmartSelectModels(inference.runtime.registry);
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
