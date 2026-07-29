import { MODEL_ID, MODEL_SIZE, FULL_MODEL_URL, rgbaToNchw, tensorToMask } from './editor-core.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';
const modelCache = new Map();

function progressEvent(event = {}) {
  const loaded = Number(event.loaded) || 0;
  const total = Number(event.total) || 0;
  const progress = Number.isFinite(Number(event.progress)) ? Number(event.progress) : total ? (loaded / total) * 100 : null;
  return {
    label: event.file || event.name || event.status || event.stage || 'Model',
    loaded,
    total,
    progress
  };
}

async function fetchModel(url, onProgress = () => {}) {
  if (modelCache.has(url)) return modelCache.get(url).slice();
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    modelCache.set(url, bytes);
    onProgress({ label: 'Model', loaded: bytes.byteLength, total: bytes.byteLength, progress: 100 });
    return bytes.slice();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ label: 'Model', loaded, total, progress: total ? (loaded / total) * 100 : null });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  modelCache.set(url, bytes);
  onProgress({ label: 'Model', loaded, total: total || loaded, progress: 100 });
  return bytes.slice();
}

export class SegmentationEngine {
  constructor({ status = () => {}, progress = () => {} } = {}) {
    this.status = status;
    this.progress = progress;
    this.backend = null;
    this.runtimeLabel = 'Nieuruchomiony';
    this.preference = null;
    this.session = null;
    this.model = null;
    this.processor = null;
    this.RawImage = null;
  }

  capabilities() {
    return {
      webnn: Boolean(navigator.ml?.createContext),
      webgpu: Boolean(navigator.gpu),
      wasm: Boolean(globalThis.WebAssembly)
    };
  }

  async dispose() {
    try { if (this.session?.release) await this.session.release(); } catch {}
    try { if (this.model?.dispose) await this.model.dispose(); } catch {}
    this.session = null;
    this.model = null;
    this.processor = null;
    this.RawImage = null;
    this.backend = null;
    this.preference = null;
    this.runtimeLabel = 'Nieuruchomiony';
  }

  candidates(preference) {
    const caps = this.capabilities();
    if (preference === 'npu') return caps.webnn ? ['npu'] : [];
    if (preference === 'gpu') return caps.webgpu ? ['webgpu'] : [];
    if (preference === 'cpu') return caps.wasm ? ['wasm'] : [];
    return [...(caps.webnn ? ['npu'] : []), ...(caps.webgpu ? ['webgpu'] : []), ...(caps.wasm ? ['wasm'] : [])];
  }

  async initialize(preference = 'auto') {
    if (this.backend && this.preference === preference) return this.backend;
    await this.dispose();
    const backends = this.candidates(preference);
    if (!backends.length) throw new Error('Wybrany akcelerator nie jest dostępny w tej przeglądarce.');
    const errors = [];
    for (const backend of backends) {
      try {
        if (backend === 'npu') await this.initNpu();
        else await this.initTransformers(backend);
        this.backend = backend;
        this.preference = preference;
        this.runtimeLabel = backend === 'npu' ? 'WebNN direct' : 'Transformers.js';
        return backend;
      } catch (error) {
        errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
        await this.dispose();
      }
    }
    throw new Error(errors.join(' | '));
  }

  async initNpu() {
    if (!globalThis.ort) throw new Error('ONNX Runtime Web nie został załadowany.');
    this.status('Ładowanie modelu MODNet dla NPU…');
    const bytes = await fetchModel(FULL_MODEL_URL, this.progress);
    this.status('Tworzenie sesji WebNN / NPU…');
    this.session = await ort.InferenceSession.create(bytes, {
      executionProviders: [{ name: 'webnn', deviceType: 'npu', powerPreference: 'low-power' }],
      graphOptimizationLevel: 'all',
      freeDimensionOverrides: { batch_size: 1, num_channels: 3, height: MODEL_SIZE, width: MODEL_SIZE }
    });
  }

  async initTransformers(backend) {
    this.status(`Ładowanie runtime ${backend === 'webgpu' ? 'GPU' : 'CPU'}…`);
    const { AutoModel, AutoProcessor, RawImage, env } = await import(TRANSFORMERS_URL);
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
    const progress = event => this.progress(progressEvent(event));
    const modelOptions = backend === 'webgpu'
      ? { device: 'webgpu', dtype: 'fp32', progress_callback: progress }
      : { dtype: 'q8', progress_callback: progress };
    this.model = await AutoModel.from_pretrained(MODEL_ID, modelOptions);
    this.processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: progress });
    this.RawImage = RawImage;
  }

  async run(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Silnik oczekuje canvasa wejściowego.');
    if (this.backend === 'npu') {
      const inputCanvas = document.createElement('canvas');
      inputCanvas.width = MODEL_SIZE;
      inputCanvas.height = MODEL_SIZE;
      const ctx = inputCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, MODEL_SIZE, MODEL_SIZE);
      const data = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
      const tensor = new ort.Tensor('float32', rgbaToNchw(data, MODEL_SIZE, MODEL_SIZE), [1, 3, MODEL_SIZE, MODEL_SIZE]);
      const outputs = await this.session.run({ [this.session.inputNames[0]]: tensor });
      return tensorToMask(outputs[this.session.outputNames[0]] || Object.values(outputs)[0]);
    }
    if (!this.model || !this.processor || !this.RawImage) throw new Error('Runtime Transformers.js nie został zainicjalizowany.');
    const image = await this.RawImage.read(canvas);
    const { pixel_values } = await this.processor(image);
    const outputs = await this.model({ input: pixel_values });
    const output = outputs.output || Object.values(outputs).find(value => value?.data && value?.dims);
    return tensorToMask(output);
  }
}
