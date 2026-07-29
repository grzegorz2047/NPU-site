import { normalizeDepthOutput, scaleDepthMap } from './editor-depth-map.js';

export class DepthEngine {
  constructor({ inferenceEngine = globalThis.localStudioInference, runtime = inferenceEngine?.runtime, registry = runtime?.registry } = {}) {
    if (!runtime || !registry) throw new Error('Mapa głębi wymaga wspólnego runtime’u modeli obrazu.');
    this.runtime = runtime;
    this.registry = registry;
    this.task = null;
    this.model = registry.list().find(model => model.task === 'depth-estimation');
    if (!this.model) throw new Error('Rejestr nie zawiera modelu estymacji głębi.');
  }
  async analyze(canvas, { mode = 'auto', width = canvas.width, height = canvas.height, invert = false, onProgress = () => {} } = {}) {
    this.task = this.runtime.enqueue({ modelId: this.model.id, input: canvas, mode: normalizeMode(mode), preview: true, priority: 8, metadata: { taskId: `depth-${Date.now().toString(36)}` }, onProgress });
    try {
      const completed = await this.task.promise;
      const normalized = normalizeDepthOutput(completed.result, 0, 0, { invert });
      const data = scaleDepthMap(normalized.data, normalized.width, normalized.height, width, height);
      return { data, width, height, benchmark: completed.benchmark, backend: completed.benchmark?.metadata?.actualBackend ?? completed.backend ?? null, modelId: this.model.id, modelVersion: this.model.version };
    } finally { this.task = null; }
  }
  cancel(reason = 'Estymacja głębi anulowana.') { return this.task?.cancel(reason) ?? false; }
}
function normalizeMode(mode) { return mode === 'gpu' ? 'webgpu' : mode === 'cpu' ? 'wasm' : mode || 'auto'; }
