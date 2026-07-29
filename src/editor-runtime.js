import { MODEL_ID, MODEL_SIZE, FULL_MODEL_URL, rgbaToNchw, tensorToMask } from './editor-core.js';
import { ImageInferenceRuntime } from './editor-inference-runtime.js';
import { ModelRegistry, modelCacheKey } from './editor-model-registry.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
const MODNET_MODEL_ID = 'modnet-portrait-matting';
const DEPTH_MODEL_ID = 'depth-anything-v2-small';

export class SegmentationEngine {
  constructor({ status = () => {}, progress = () => {}, runtime = null } = {}) {
    this.status = status;
    this.progress = progress;
    this.registry = runtime?.registry ?? new ModelRegistry();
    this.runtime = runtime ?? new ImageInferenceRuntime({
      registry: this.registry,
      adapters: createBrowserAdapters({ status })
    });
    this.backend = null;
    this.runtimeLabel = 'Nieuruchomiony';
    this.preference = null;
    this.currentTask = null;
    this.runtime.subscribe(event => this.publishRuntimeEvent(event));
    globalThis.localStudioInference = this;
  }

  capabilities() {
    const capabilities = this.runtime.capabilities();
    return { webnn: capabilities.npu, webgpu: capabilities.webgpu, wasm: capabilities.wasm };
  }

  candidates(preference) {
    return this.registry.resolveCandidates(MODNET_MODEL_ID, normalizePreference(preference), this.runtime.capabilities());
  }

  async initialize(preference = 'auto') {
    const mode = normalizePreference(preference);
    if (this.backend && this.preference === mode) return this.backend;
    const initialized = await this.runtime.initialize({
      modelId: MODNET_MODEL_ID,
      mode,
      onProgress: event => this.progress(normalizeProgress(event))
    });
    this.backend = initialized.backend;
    this.preference = mode;
    this.runtimeLabel = runtimeLabel(initialized.backend, initialized.ioBinding);
    return this.backend;
  }

  async run(canvas, { preview = false, priority = 10 } = {}) {
    assertCanvas(canvas);
    const mode = normalizePreference(this.preference ?? 'auto');
    this.currentTask = this.runtime.enqueue({
      modelId: MODNET_MODEL_ID,
      input: canvas,
      mode,
      preview,
      priority,
      metadata: { taskId: `modnet-${Date.now().toString(36)}` },
      onProgress: event => this.progress(normalizeProgress(event))
    });
    try {
      const completed = await this.currentTask.promise;
      this.backend = completed.backend;
      this.preference = mode;
      const session = this.runtime.diagnostics().sessionDetails?.find(item => item.key.endsWith(`:${completed.backend}`));
      this.runtimeLabel = runtimeLabel(completed.backend, Boolean(session?.ioBinding));
      return completed.result;
    } finally {
      this.currentTask = null;
    }
  }

  async runDepth(canvas, { preference = 'auto', preview = true, priority = 5 } = {}) {
    assertCanvas(canvas);
    this.currentTask = this.runtime.enqueue({
      modelId: DEPTH_MODEL_ID,
      input: canvas,
      mode: normalizePreference(preference),
      preview,
      priority,
      metadata: { taskId: `depth-${Date.now().toString(36)}` },
      onProgress: event => this.progress(normalizeProgress(event))
    });
    try {
      return await this.currentTask.promise;
    } finally {
      this.currentTask = null;
    }
  }

  cancel(reason = 'Inferencja została anulowana.') {
    if (this.currentTask?.cancel(reason)) return true;
    const queue = this.runtime.diagnostics().queue;
    const task = queue.running[0] ?? queue.pending[0];
    return task ? this.runtime.queue.cancel(task.id, reason) : false;
  }

  diagnostics() {
    return this.runtime.diagnostics();
  }

  models() {
    return this.registry.list();
  }

  async dispose() {
    this.cancel('Runtime został zamknięty.');
    await this.runtime.dispose();
    this.backend = null;
    this.preference = null;
    this.runtimeLabel = 'Nieuruchomiony';
  }

  publishRuntimeEvent(event) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent('localstudio:runtime-state', {
      detail: { type: event.type, diagnostics: this.runtime.diagnostics(), event: event.detail }
    }));
  }
}

export function createBrowserAdapters({ status = () => {} } = {}) {
  return {
    npu: async context => createNpuSession(context, status),
    webgpu: async context => createTransformersSession(context, 'webgpu', status),
    wasm: async context => createTransformersSession(context, 'wasm', status)
  };
}

async function createNpuSession({ model, cache, signal, benchmark, onProgress }, status) {
  if (model.id !== MODNET_MODEL_ID) throw new Error(`Model ${model.name} nie ma zweryfikowanego adaptera NPU.`);
  if (!globalThis.ort) throw new Error('ONNX Runtime Web nie został załadowany.');
  status('Ładowanie modelu MODNet dla NPU…');
  const url = model.artifacts.npu || FULL_MODEL_URL;
  const bytes = await benchmark.measure('download', () => cache.get(url, {
    key: modelCacheKey(model, 'npu'),
    signal,
    onProgress: event => onProgress(normalizeProgress(event))
  }));
  status('Tworzenie sesji WebNN / NPU…');
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: [{ name: 'webnn', deviceType: 'npu', powerPreference: 'low-power' }],
    graphOptimizationLevel: 'all',
    freeDimensionOverrides: { batch_size: 1, num_channels: 3, height: MODEL_SIZE, width: MODEL_SIZE }
  });
  const ioBinding = Boolean(session.createBinding || globalThis.ort?.Tensor?.fromMLTensor);
  return {
    ioBinding,
    preprocess: canvas => canvasToModnetTensor(canvas),
    run: tensor => session.run({ [session.inputNames[0]]: tensor }),
    postprocess: outputs => tensorToMask(outputs[session.outputNames[0]] || Object.values(outputs)[0]),
    dispose: async () => { if (session.release) await session.release(); }
  };
}

async function createTransformersSession({ model, backend, signal, benchmark, onProgress }, runtimeBackend, status) {
  if (backend !== runtimeBackend) throw new Error(`Nieprawidłowy adapter ${runtimeBackend}.`);
  status(`Ładowanie runtime ${backend === 'webgpu' ? 'GPU' : 'CPU'}…`);
  const transformers = await benchmark.measure('download', () => import(TRANSFORMERS_URL));
  configureWasm(transformers.env);
  const progressCallback = event => onProgress(progressEvent(event));

  if (model.id === MODNET_MODEL_ID) {
    const modelOptions = backend === 'webgpu'
      ? { device: 'webgpu', dtype: 'fp32', progress_callback: progressCallback }
      : { dtype: 'q8', progress_callback: progressCallback };
    const [loadedModel, processor] = await benchmark.measure('download', () => Promise.all([
      transformers.AutoModel.from_pretrained(MODEL_ID, modelOptions),
      transformers.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: progressCallback })
    ]));
    return {
      ioBinding: false,
      preprocess: async canvas => {
        throwIfAborted(signal);
        const image = await transformers.RawImage.read(canvas);
        const { pixel_values } = await processor(image);
        return pixel_values;
      },
      run: pixelValues => loadedModel({ input: pixelValues }),
      postprocess: outputs => {
        const output = outputs.output || Object.values(outputs).find(value => value?.data && value?.dims);
        return tensorToMask(output);
      },
      dispose: async () => { if (loadedModel.dispose) await loadedModel.dispose(); }
    };
  }

  if (model.task === 'depth-estimation') {
    const pipelineOptions = backend === 'webgpu'
      ? { device: 'webgpu', dtype: 'fp16', progress_callback: progressCallback }
      : { dtype: 'q8', progress_callback: progressCallback };
    const pipeline = await benchmark.measure('download', () => transformers.pipeline(model.task, model.repository, pipelineOptions));
    return {
      ioBinding: false,
      preprocess: (canvas, { preview }) => preview ? createPreviewCanvas(canvas, 512) : canvas,
      run: canvas => pipeline(canvas),
      postprocess: output => output?.depth ?? output,
      dispose: async () => { if (pipeline.dispose) await pipeline.dispose(); }
    };
  }

  throw new Error(`Brak adaptera Transformers.js dla zadania ${model.task}.`);
}

function canvasToModnetTensor(canvas) {
  const inputCanvas = document.createElement('canvas');
  inputCanvas.width = MODEL_SIZE;
  inputCanvas.height = MODEL_SIZE;
  const context = inputCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const data = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  return new ort.Tensor('float32', rgbaToNchw(data, MODEL_SIZE, MODEL_SIZE), [1, 3, MODEL_SIZE, MODEL_SIZE]);
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

function configureWasm(env) {
  if (!env?.backends?.onnx?.wasm) return;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

function progressEvent(event = {}) {
  const loaded = Number(event.loaded) || 0;
  const total = Number(event.total) || 0;
  const progress = Number.isFinite(Number(event.progress)) ? Number(event.progress) : total ? loaded / total * 100 : null;
  return normalizeProgress({
    stage: event.stage || event.status || 'download',
    label: event.file || event.name || event.status || event.stage || 'Model',
    loaded,
    total,
    progress
  });
}

function normalizeProgress(event = {}) {
  return {
    stage: event.stage || 'runtime',
    label: event.label || event.stage || 'Model',
    loaded: Number(event.loaded) || 0,
    total: Number(event.total) || 0,
    progress: Number.isFinite(Number(event.progress)) ? Math.max(0, Math.min(100, Number(event.progress))) : null,
    cached: Boolean(event.cached),
    completed: Number(event.completed) || 0
  };
}

function normalizePreference(preference) {
  if (preference === 'gpu') return 'webgpu';
  if (preference === 'cpu') return 'wasm';
  return preference || 'auto';
}

function runtimeLabel(backend, ioBinding) {
  if (backend === 'npu') return ioBinding ? 'WebNN direct · IO API' : 'WebNN direct';
  return 'Transformers.js';
}

function assertCanvas(canvas) {
  const Canvas = globalThis.HTMLCanvasElement;
  if (!Canvas || !(canvas instanceof Canvas)) throw new Error('Silnik oczekuje canvasa wejściowego.');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException(String(signal.reason || 'Operacja anulowana.'), 'AbortError');
}

export { MODNET_MODEL_ID, DEPTH_MODEL_ID };

if (typeof document !== 'undefined') import('./editor-runtime-ui.js').catch(() => {});
