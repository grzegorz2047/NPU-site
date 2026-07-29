import { scaleMask } from './editor-smart-mask.js';
import {
  createPersonObjectFromMask,
  mergeSmartObjects,
  normalizeDetections,
  normalizeSemanticSegments,
  serializeSmartObject
} from './editor-smart-objects.js';

export const SMART_SEGMENTATION_MODEL_ID = 'smart-segformer-ade20k';
export const SMART_DETECTION_MODEL_ID = 'smart-detr-coco';
export const SMART_PERSON_MODEL_ID = 'modnet-portrait-matting';

export const SMART_SELECT_MODELS = Object.freeze([
  Object.freeze({
    id: SMART_SEGMENTATION_MODEL_ID,
    name: 'SegFormer B0 ADE20K',
    version: 'onnx-community-main-2026-07',
    repository: 'onnx-community/segformer-b0-finetuned-ade-512-512',
    license: 'Apache-2.0',
    task: 'image-segmentation',
    inputs: [{ name: 'image', type: 'image', layout: 'pipeline-managed' }],
    outputs: [{ name: 'segments', type: 'semantic-mask[]' }],
    preprocessing: { resize: 'pipeline', colorSpace: 'RGB', previewMaxSide: 768 },
    artifacts: { webgpu: 'transformers.js', wasm: 'transformers.js' },
    compatibility: {
      npu: { supported: false, note: 'Kontrakt operatorów WebNN nie został zweryfikowany.' },
      webgpu: { supported: true, note: 'Transformers.js image-segmentation.' },
      wasm: { supported: true, note: 'Transformers.js WASM fallback.' }
    }
  }),
  Object.freeze({
    id: SMART_DETECTION_MODEL_ID,
    name: 'DETR ResNet-50 COCO',
    version: 'onnx-community-main-2026-07',
    repository: 'onnx-community/detr-resnet-50',
    license: 'Apache-2.0',
    task: 'object-detection',
    inputs: [{ name: 'image', type: 'image', layout: 'pipeline-managed' }],
    outputs: [{ name: 'objects', type: 'bounding-box[]' }],
    preprocessing: { resize: 'pipeline', colorSpace: 'RGB', previewMaxSide: 960 },
    artifacts: { webgpu: 'transformers.js', wasm: 'transformers.js' },
    compatibility: {
      npu: { supported: false, note: 'Kontrakt operatorów WebNN nie został zweryfikowany.' },
      webgpu: { supported: true, note: 'Transformers.js object-detection.' },
      wasm: { supported: true, note: 'Transformers.js WASM fallback.' }
    }
  })
]);

export class SmartSelectEngine {
  constructor({ inferenceEngine = globalThis.localStudioInference, runtime = inferenceEngine?.runtime, registry = runtime?.registry, previewFactory = createPreviewCanvas } = {}) {
    if (!runtime || !registry) throw new Error('Smart Select wymaga wspólnego runtime’u modeli obrazu.');
    this.inferenceEngine = inferenceEngine;
    this.runtime = runtime;
    this.registry = registry;
    this.previewFactory = previewFactory;
    this.currentTasks = new Set();
    this.listeners = new Set();
    registerSmartSelectModels(registry);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async analyze(canvas, options = {}) {
    assertCanvasLike(canvas);
    const width = Math.max(1, Math.trunc(Number(options.width ?? canvas.width)));
    const height = Math.max(1, Math.trunc(Number(options.height ?? canvas.height)));
    const mode = normalizeMode(options.mode ?? 'auto');
    const semanticCanvas = this.previewFactory(canvas, options.semanticMaxSide ?? 768);
    const detectionCanvas = this.previewFactory(canvas, options.detectionMaxSide ?? 960);
    const progress = new AnalysisProgress(options.onProgress ?? (() => {}));
    const reports = [];

    this.emit('start', { width, height, mode });
    try {
      const semantic = await this.runModel({
        modelId: SMART_SEGMENTATION_MODEL_ID,
        input: semanticCanvas,
        mode,
        priority: 9,
        metadata: { taskId: `smart-semantic-${Date.now().toString(36)}` },
        onProgress: event => progress.update('semantic', event)
      });
      reports.push(semantic.benchmark);
      const semanticObjects = normalizeSemanticSegments(semantic.result, width, height, options.semanticOptions);

      const detection = await this.runModel({
        modelId: SMART_DETECTION_MODEL_ID,
        input: detectionCanvas,
        mode,
        priority: 8,
        metadata: { taskId: `smart-detection-${Date.now().toString(36)}` },
        onProgress: event => progress.update('detection', event)
      });
      reports.push(detection.benchmark);
      const scaledDetections = scaleDetectionResults(detection.result, detectionCanvas.width, detectionCanvas.height, width, height);
      const detectionObjects = normalizeDetections(scaledDetections, width, height, options.detectionOptions);

      let objects = mergeSmartObjects(detectionObjects, semanticObjects, options.mergeOptions);
      if (options.includePersonMatting !== false) {
        try {
          const person = await this.runModel({
            modelId: SMART_PERSON_MODEL_ID,
            input: canvas,
            mode,
            priority: 10,
            metadata: { taskId: `smart-person-${Date.now().toString(36)}` },
            onProgress: event => progress.update('person', event)
          });
          reports.push(person.benchmark);
          const side = Math.max(1, Math.round(Math.sqrt(person.result.length)));
          const scaled = scaleMask(person.result, side, Math.max(1, Math.round(person.result.length / side)), width, height);
          const personObject = createPersonObjectFromMask(scaled, width, height, { source: 'modnet', score: 1 });
          if (personObject) objects = mergePersonObject(objects, personObject);
        } catch (error) {
          if (mode !== 'auto' || error?.name === 'AbortError') throw error;
          this.emit('warning', { stage: 'person', error });
        }
      }
      const result = {
        width,
        height,
        objects,
        reports,
        backendSummary: summarizeBackends(reports),
        createdAt: new Date().toISOString()
      };
      progress.complete();
      this.emit('complete', { result });
      return result;
    } catch (error) {
      this.emit(error?.name === 'AbortError' ? 'cancel' : 'error', { error });
      throw error;
    }
  }

  cancel(reason = 'Smart Select anulowany.') {
    let cancelled = false;
    for (const task of this.currentTasks) cancelled = task.cancel(reason) || cancelled;
    return cancelled;
  }

  diagnostics() {
    return {
      models: SMART_SELECT_MODELS.map(model => this.registry.get(model.id)),
      activeTasks: this.currentTasks.size,
      runtime: this.runtime.diagnostics()
    };
  }

  async runModel(options) {
    const task = this.runtime.enqueue(options);
    this.currentTasks.add(task);
    try {
      return await task.promise;
    } finally {
      this.currentTasks.delete(task);
    }
  }

  emit(type, detail) {
    const event = { type, detail, engine: this };
    for (const listener of this.listeners) listener(event);
  }
}

export function registerSmartSelectModels(registry) {
  for (const model of SMART_SELECT_MODELS) {
    let existing = null;
    try { existing = registry.get(model.id); } catch {}
    if (!existing) registry.register(model);
  }
  return registry;
}

export function serializeSmartAnalysis(analysis) {
  return {
    width: analysis.width,
    height: analysis.height,
    objects: analysis.objects.map(serializeSmartObject),
    backendSummary: analysis.backendSummary,
    createdAt: analysis.createdAt
  };
}

function mergePersonObject(objects, personObject) {
  const withoutWeakPerson = (objects ?? []).filter(object => object.category !== 'person' || object.source === 'modnet');
  const existing = withoutWeakPerson.find(object => object.category === 'person');
  if (existing?.source === 'modnet') return withoutWeakPerson;
  return [personObject, ...withoutWeakPerson.filter(object => object.category !== 'person')];
}

function scaleDetectionResults(results, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scaleX = targetWidth / Math.max(1, sourceWidth);
  const scaleY = targetHeight / Math.max(1, sourceHeight);
  return (results ?? []).map(result => {
    const box = result?.box ?? result?.bbox;
    if (!box) return result;
    return {
      ...result,
      box: {
        xmin: Number(box.xmin ?? box.x ?? box.left) * scaleX,
        ymin: Number(box.ymin ?? box.y ?? box.top) * scaleY,
        xmax: Number(box.xmax ?? box.right ?? ((box.x ?? box.left) + box.width)) * scaleX,
        ymax: Number(box.ymax ?? box.bottom ?? ((box.y ?? box.top) + box.height)) * scaleY
      }
    };
  });
}

function summarizeBackends(reports) {
  const items = reports.filter(Boolean).map(report => ({
    modelId: report.metadata?.modelId,
    backend: report.metadata?.actualBackend,
    fallbackUsed: Boolean(report.metadata?.fallbackUsed),
    durationMs: report.totalDurationMs
  }));
  return {
    items,
    backends: [...new Set(items.map(item => item.backend).filter(Boolean))],
    totalDurationMs: items.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0)
  };
}

class AnalysisProgress {
  constructor(callback) {
    this.callback = callback;
    this.values = { semantic: 0, detection: 0, person: 0 };
  }
  update(stage, event = {}) {
    this.values[stage] = Number.isFinite(Number(event.progress)) ? Number(event.progress) : this.values[stage];
    const weights = { semantic: 0.45, detection: 0.35, person: 0.2 };
    const progress = Object.entries(this.values).reduce((sum, [key, value]) => sum + value * weights[key], 0);
    this.callback({ ...event, stage, progress: Math.min(99, progress) });
  }
  complete() { this.callback({ stage: 'complete', label: 'Smart Select gotowy', progress: 100 }); }
}

function createPreviewCanvas(source, maxSide) {
  if (!source?.width || !source?.height || typeof document === 'undefined') return source;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (scale >= 1) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function normalizeMode(mode) {
  if (mode === 'gpu') return 'webgpu';
  if (mode === 'cpu') return 'wasm';
  return mode || 'auto';
}

function assertCanvasLike(canvas) {
  if (!canvas || !Number(canvas.width) || !Number(canvas.height)) throw new Error('Smart Select wymaga obrazu wejściowego.');
}
