import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFIED_SMART_SELECT_REPOSITORIES,
  installVerifiedSmartSelectModels
} from '../src/editor-smart-select-bootstrap.js';
import {
  SMART_DETECTION_MODEL_ID,
  SMART_SEGMENTATION_MODEL_ID
} from '../src/editor-smart-select-engine.js';
import { ModelRegistry } from '../src/editor-model-registry.js';
import { createRetouchCanvasControllerAdapter } from '../src/editor-retouch-bootstrap.js';
import { RetouchController } from '../src/editor-retouch-ui.js';

test('Smart Select replaces removed model repositories before engine startup', () => {
  const registry = installVerifiedSmartSelectModels(new ModelRegistry());
  const segmentation = registry.get(SMART_SEGMENTATION_MODEL_ID);
  const detection = registry.get(SMART_DETECTION_MODEL_ID);

  assert.equal(segmentation.repository, 'Xenova/segformer-b0-finetuned-ade-512-512');
  assert.equal(detection.repository, 'Xenova/detr-resnet-50');
  assert.equal(segmentation.repository, VERIFIED_SMART_SELECT_REPOSITORIES[SMART_SEGMENTATION_MODEL_ID]);
  assert.equal(detection.repository, VERIFIED_SMART_SELECT_REPOSITORIES[SMART_DETECTION_MODEL_ID]);
  assert.match(segmentation.version, /xenova-main-2026-07-fix1/);
  assert.deepEqual(registry.resolveCandidates(SMART_SEGMENTATION_MODEL_ID, 'auto', {
    npu: true,
    webgpu: true,
    wasm: true
  }), ['webgpu', 'wasm']);
});

test('retouch maps pointer coordinates through the current CanvasController viewport', () => {
  const calls = [];
  const canvasController = {
    viewport: { zoom: 1 },
    eventDocumentPoint(event) {
      calls.push({ ...event, zoom: this.viewport.zoom });
      return { x: event.clientX / this.viewport.zoom, y: event.clientY / this.viewport.zoom };
    }
  };
  const adapted = createRetouchCanvasControllerAdapter(canvasController);

  canvasController.viewport = { zoom: 2 };
  const point = RetouchController.prototype.point.call({
    canvasController: adapted,
    documentModel: { width: 8, height: 6 }
  }, { clientX: 20, clientY: -4, pressure: 0.4 });

  assert.deepEqual(point, { x: 7, y: 0, pressure: 0.4 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { clientX: 20, clientY: -4, zoom: 2 });
  assert.equal(adapted.viewport.zoom, 2);
});
