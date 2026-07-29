export const INFERENCE_BACKENDS = Object.freeze(['npu', 'webgpu', 'wasm']);
export const RUNTIME_MODES = Object.freeze(['auto', 'npu', 'webgpu', 'wasm']);

export const BUILTIN_IMAGE_MODELS = Object.freeze([
  {
    id: 'modnet-portrait-matting',
    name: 'MODNet portrait matting',
    version: 'onnx-community-main-v1',
    license: 'Apache-2.0',
    repository: 'onnx-community/modnet-webnn',
    task: 'background-removal',
    inputs: [{ name: 'image', kind: 'image', layout: 'NCHW', dtype: 'float32', width: 256, height: 256 }],
    outputs: [{ name: 'mask', kind: 'mask', dtype: 'float32', width: 256, height: 256 }],
    preprocessing: { resize: 'stretch', width: 256, height: 256, rescale: 1 / 255, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
    artifacts: {
      npu: 'https://huggingface.co/onnx-community/modnet-webnn/resolve/main/onnx/model.onnx',
      webgpu: 'onnx-community/modnet-webnn',
      wasm: 'onnx-community/modnet-webnn'
    },
    compatibility: {
      npu: { supported: true, ioBinding: true, note: 'ONNX Runtime Web + WebNN deviceType=npu' },
      webgpu: { supported: true, ioBinding: false, note: 'Transformers.js WebGPU' },
      wasm: { supported: true, ioBinding: false, note: 'Transformers.js WASM' }
    }
  },
  {
    id: 'depth-anything-v2-small',
    name: 'Depth Anything V2 Small',
    version: 'onnx-community-main-v1',
    license: 'Apache-2.0',
    repository: 'onnx-community/depth-anything-v2-small',
    task: 'depth-estimation',
    inputs: [{ name: 'image', kind: 'image', layout: 'NCHW', dtype: 'float32', dynamic: true }],
    outputs: [{ name: 'depth', kind: 'depth-map', dtype: 'float32', dynamic: true }],
    preprocessing: { resize: 'model-default', normalize: true },
    artifacts: {
      webgpu: 'onnx-community/depth-anything-v2-small',
      wasm: 'onnx-community/depth-anything-v2-small'
    },
    compatibility: {
      npu: { supported: false, ioBinding: false, note: 'NPU contract not verified yet' },
      webgpu: { supported: true, ioBinding: false, note: 'Transformers.js depth-estimation pipeline' },
      wasm: { supported: true, ioBinding: false, note: 'Transformers.js WASM' }
    }
  }
]);

export class ModelRegistry {
  constructor(models = BUILTIN_IMAGE_MODELS) {
    this.models = new Map();
    for (const model of models) this.register(model);
  }

  register(model) {
    const normalized = normalizeModel(model);
    if (this.models.has(normalized.id)) throw new Error(`Model ${normalized.id} jest już zarejestrowany.`);
    this.models.set(normalized.id, normalized);
    return normalized;
  }

  replace(model) {
    const normalized = normalizeModel(model);
    this.models.set(normalized.id, normalized);
    return normalized;
  }

  get(modelId) {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Nie znaleziono modelu ${modelId}.`);
    return model;
  }

  has(modelId) {
    return this.models.has(modelId);
  }

  list({ task = null } = {}) {
    const values = [...this.models.values()];
    return task ? values.filter(model => model.task === task) : values;
  }

  compatibilityMatrix(capabilities = {}) {
    return this.list().map(model => ({
      id: model.id,
      name: model.name,
      task: model.task,
      backends: Object.fromEntries(INFERENCE_BACKENDS.map(backend => {
        const contract = model.compatibility[backend];
        return [backend, {
          ...contract,
          available: Boolean(contract.supported && capabilities[backend])
        }];
      }))
    }));
  }

  resolveCandidates(modelId, mode = 'auto', capabilities = {}) {
    const model = this.get(modelId);
    if (!RUNTIME_MODES.includes(mode)) throw new Error(`Nieznany tryb runtime: ${mode}`);
    const order = mode === 'auto' ? INFERENCE_BACKENDS : [mode];
    const candidates = order.filter(backend => model.compatibility[backend]?.supported && capabilities[backend]);
    if (!candidates.length) {
      if (mode === 'npu') throw new Error(`Model ${model.name} nie może zostać uruchomiony w trybie Tylko NPU.`);
      throw new Error(`Brak zgodnego backendu dla modelu ${model.name} w trybie ${mode}.`);
    }
    return candidates;
  }
}

export function modelCacheKey(model, backend) {
  return `${model.id}@${model.version}:${backend}`;
}

function normalizeModel(model) {
  if (!model || typeof model !== 'object') throw new TypeError('Definicja modelu musi być obiektem.');
  const id = String(model.id ?? '').trim();
  if (!id) throw new Error('Model wymaga identyfikatora.');
  const compatibility = {};
  for (const backend of INFERENCE_BACKENDS) {
    const value = model.compatibility?.[backend];
    compatibility[backend] = typeof value === 'boolean'
      ? { supported: value, ioBinding: false, note: '' }
      : {
          supported: Boolean(value?.supported),
          ioBinding: Boolean(value?.ioBinding),
          note: String(value?.note ?? '')
        };
  }
  if (!Object.values(compatibility).some(item => item.supported)) throw new Error(`Model ${id} nie obsługuje żadnego backendu.`);
  return deepFreeze({
    id,
    name: String(model.name ?? id),
    version: String(model.version ?? '1'),
    license: String(model.license ?? 'unknown'),
    repository: String(model.repository ?? ''),
    task: String(model.task ?? 'custom'),
    inputs: clone(model.inputs ?? []),
    outputs: clone(model.outputs ?? []),
    preprocessing: clone(model.preprocessing ?? {}),
    artifacts: clone(model.artifacts ?? {}),
    compatibility,
    metadata: clone(model.metadata ?? {})
  });
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
