import {
  applyLocalRestoration,
  createPreviewRegion,
  createScaledTilePlan,
  estimateRestorationMemory,
  normalizeRestorationOptions,
  resizeRgbaBilinear,
  stitchScaledRgbaTiles,
  unsharpMask
} from './editor-restoration-core.js';

export class RestorationEngine {
  constructor({ inferenceEngine = globalThis.localStudioInference, runtime = inferenceEngine?.runtime, registry = runtime?.registry, maxMegapixels = 80 } = {}) {
    if (!runtime || !registry) throw new Error('Restoration wymaga wspólnego runtime’u modeli obrazu.');
    this.runtime = runtime;
    this.registry = registry;
    this.maxMegapixels = Math.max(1, Number(maxMegapixels) || 80);
    this.task = null;
  }

  async preview(canvas, options = {}) {
    assertCanvasLike(canvas);
    const region = createPreviewRegion(canvas.width, canvas.height, options.region, { size: options.previewSize ?? 256 });
    const crop = cropCanvas(canvas, region);
    return this.enqueue(crop, { ...options, preview: true, region, priority: options.priority ?? 12 });
  }

  async process(canvas, options = {}) {
    assertCanvasLike(canvas);
    return this.enqueue(canvas, { ...options, preview: false, priority: options.priority ?? 6 });
  }

  async enqueue(canvas, options) {
    if (this.task) throw new Error('Inne zadanie restoration jest już aktywne.');
    const normalized = normalizeRestorationOptions(options);
    const taskId = `restoration-${normalized.profileId}-${Date.now().toString(36)}`;
    this.task = this.runtime.queue.enqueue(async ({ signal, reportProgress }) => {
      const startedAt = now();
      const memory = estimateRestorationMemory(canvas.width, canvas.height, { scale: normalized.scale, tileSize: normalized.tileSize });
      if (memory.megapixels > this.maxMegapixels) throw new Error(`Wynik miałby ${memory.megapixels.toFixed(1)} MP. Zmniejsz skalę lub obraz.`);
      reportProgress({ stage: 'preprocessing', label: options.preview ? 'Przygotowanie podglądu 1:1' : 'Przygotowanie kafelków', progress: 2 });
      let result;
      let fallbackReason = null;
      if (normalized.modelId) {
        try {
          result = await this.runModelTiled(canvas, normalized, { signal, reportProgress, mode: normalizeMode(options.mode) });
        } catch (error) {
          if (error?.name === 'AbortError' || !normalized.allowLocalFallback) throw error;
          fallbackReason = error instanceof Error ? error.message : String(error);
          reportProgress({ stage: 'fallback', label: 'Model niedostępny — lokalny fallback', progress: 5 });
          result = await this.runLocalTiled(canvas, normalized, { signal, reportProgress });
        }
      } else result = await this.runLocalTiled(canvas, normalized, { signal, reportProgress });
      throwIfAborted(signal);
      const durationMs = Math.max(0, now() - startedAt);
      return {
        ...result,
        canvas: rgbaToCanvas(result.data, result.width, result.height),
        profileId: normalized.profileId,
        task: normalized.task,
        preview: Boolean(options.preview),
        region: options.region ?? null,
        memory,
        fallbackReason,
        durationMs
      };
    }, {
      id: taskId,
      priority: options.priority,
      metadata: { modelId: normalized.modelId, task: normalized.task, preview: Boolean(options.preview), restoration: true }
    });
    try {
      return await this.task.promise;
    } finally {
      this.task = null;
    }
  }

  async runModelTiled(canvas, options, { signal, reportProgress, mode }) {
    const plan = createScaledTilePlan(canvas.width, canvas.height, { tileSize: options.tileSize, overlap: options.overlap, scale: options.modelOutputScale });
    const outputs = [];
    const reports = [];
    let backend = null;
    for (const tile of plan.tiles) {
      throwIfAborted(signal);
      const tileCanvas = cropCanvas(canvas, tile);
      const completed = await this.runtime.run({
        modelId: options.modelId,
        input: tileCanvas,
        mode,
        preview: false,
        signal,
        metadata: { restorationTask: options.task, tile: tile.index, tiles: plan.tiles.length },
        onProgress: progress => reportProgress({ ...progress, tile: tile.index, total: plan.tiles.length })
      });
      backend = completed.backend;
      reports.push(completed.benchmark);
      outputs.push(await imageResultToRgba(completed.result, tile.output.width, tile.output.height, signal));
      reportProgress({ stage: 'inference', label: `Kafelek ${tile.index + 1}/${plan.tiles.length}`, completed: tile.index + 1, total: plan.tiles.length, progress: (tile.index + 1) / plan.tiles.length * 88 });
    }
    throwIfAborted(signal);
    reportProgress({ stage: 'postprocessing', label: 'Składanie bez szwów', progress: 92 });
    let stitched = stitchScaledRgbaTiles(plan, outputs);
    if (options.preserveSize) stitched = resizeRgbaBilinear(stitched.data, stitched.width, stitched.height, canvas.width, canvas.height, signal);
    if (options.sharpen > 0) stitched.data = unsharpMask(stitched.data, stitched.width, stitched.height, options.sharpen, signal);
    reportProgress({ stage: 'postprocessing', label: 'Gotowe', progress: 100 });
    return { ...stitched, backend, modelId: options.modelId, tileCount: plan.tiles.length, benchmark: aggregateReports(reports, backend) };
  }

  async runLocalTiled(canvas, options, { signal, reportProgress }) {
    const outputScale = options.task === 'super-resolution' ? options.scale : 1;
    const plan = createScaledTilePlan(canvas.width, canvas.height, { tileSize: options.tileSize, overlap: options.overlap, scale: outputScale });
    const outputs = [];
    const startedAt = now();
    for (const tile of plan.tiles) {
      throwIfAborted(signal);
      const tileCanvas = cropCanvas(canvas, tile);
      const source = canvasRgba(tileCanvas);
      const result = applyLocalRestoration(source.data, source.width, source.height, options, signal);
      outputs.push(result);
      reportProgress({ stage: 'inference', label: `Lokalny kafelek ${tile.index + 1}/${plan.tiles.length}`, completed: tile.index + 1, total: plan.tiles.length, progress: (tile.index + 1) / plan.tiles.length * 90 });
      await yieldTurn();
    }
    throwIfAborted(signal);
    const stitched = stitchScaledRgbaTiles(plan, outputs);
    reportProgress({ stage: 'postprocessing', label: 'Gotowe', progress: 100 });
    return {
      ...stitched,
      backend: 'local',
      modelId: null,
      tileCount: plan.tiles.length,
      benchmark: { metadata: { actualBackend: 'local', restorationTask: options.task }, durations: { processing: Math.max(0, now() - startedAt) }, totalMs: Math.max(0, now() - startedAt) }
    };
  }

  cancel(reason = 'Restoration anulowane.') {
    return this.task?.cancel(reason) ?? false;
  }
}

export async function imageResultToRgba(result, expectedWidth, expectedHeight, signal = null) {
  throwIfAborted(signal);
  let value = Array.isArray(result) ? result[0] : result;
  value = value?.image ?? value?.output ?? value;
  if (value?.toCanvas) value = await value.toCanvas();
  if (value?.getContext) {
    const rgba = canvasRgba(value);
    if (rgba.width === expectedWidth && rgba.height === expectedHeight) return rgba;
    return resizeRgbaBilinear(rgba.data, rgba.width, rgba.height, expectedWidth, expectedHeight, signal);
  }
  const data = value?.data;
  const width = Number(value?.width ?? value?.dims?.at?.(-1));
  const height = Number(value?.height ?? value?.dims?.at?.(-2));
  if (data && width > 0 && height > 0) {
    const rgba = normalizeRawImageData(data, width, height);
    if (width === expectedWidth && height === expectedHeight) return { data: rgba, width, height };
    return resizeRgbaBilinear(rgba, width, height, expectedWidth, expectedHeight, signal);
  }
  throw new Error('Model image-to-image nie zwrócił obrazu możliwego do złożenia.');
}

function normalizeRawImageData(data, width, height) {
  if (data.length === width * height * 4) return data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data, value => normalizeChannel(value));
  if (data.length === width * height * 3) {
    const output = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      output[pixel * 4] = normalizeChannel(data[pixel * 3]);
      output[pixel * 4 + 1] = normalizeChannel(data[pixel * 3 + 1]);
      output[pixel * 4 + 2] = normalizeChannel(data[pixel * 3 + 2]);
      output[pixel * 4 + 3] = 255;
    }
    return output;
  }
  throw new Error('Nieprawidłowy bufor obrazu modelu.');
}

function normalizeChannel(value) { const number = Number(value) || 0; return Math.round(number >= 0 && number <= 1 ? number * 255 : number); }
function canvasRgba(canvas) { const context = canvas.getContext('2d', { willReadFrequently: true }); const image = context.getImageData(0, 0, canvas.width, canvas.height); return { data: image.data, width: canvas.width, height: canvas.height }; }
function cropCanvas(source, rect) { const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height; canvas.getContext('2d').drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height); return canvas; }
function rgbaToCanvas(data, width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); const image = context.createImageData(width, height); image.data.set(data); context.putImageData(image, 0, 0); return canvas; }
function aggregateReports(reports, backend) { const durations = {}; let totalMs = 0; for (const report of reports) { totalMs += Number(report?.totalMs) || 0; for (const [key, value] of Object.entries(report?.durations ?? {})) durations[key] = (durations[key] ?? 0) + (Number(value) || 0); } return { metadata: { actualBackend: backend, tiles: reports.length }, durations, totalMs }; }
function normalizeMode(mode) { return mode === 'gpu' ? 'webgpu' : mode === 'cpu' ? 'wasm' : mode || 'auto'; }
function assertCanvasLike(canvas) { if (!canvas?.getContext || !canvas.width || !canvas.height) throw new Error('Restoration wymaga canvasa wejściowego.'); }
function throwIfAborted(signal) { if (signal?.aborted) throw new DOMException(String(signal.reason || 'Operacja anulowana.'), 'AbortError'); }
function now() { return globalThis.performance?.now?.() ?? Date.now(); }
function yieldTurn() { return new Promise(resolve => setTimeout(resolve, 0)); }
