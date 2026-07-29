import { processRetouchStroke } from './editor-retouch.js';

let sequence = 0;

export class RetouchProcessor {
  constructor({ workerFactory = defaultWorkerFactory } = {}) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.pending = new Map();
    this.failed = false;
  }

  async process(sourceInput, width, height, stroke, selectionMask = null, { signal } = {}) {
    throwIfAborted(signal);
    const source = sourceInput?.data ?? sourceInput;
    if (!source || source.length !== width * height * 4) throw new Error('Processor retuszu wymaga pełnych danych RGBA.');
    const worker = this.getWorker();
    if (!worker) return processRetouchStroke(source, width, height, stroke, selectionMask);
    const id = `retouch-job-${++sequence}`;
    const sourceCopy = new Uint8ClampedArray(source);
    const selectionCopy = selectionMask ? new Uint8Array(selectionMask) : null;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(abortError(signal?.reason));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: result => {
          signal?.removeEventListener('abort', abort);
          resolve({ ...result, data: new Uint8ClampedArray(result.data) });
        },
        reject: error => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        }
      });
      worker.postMessage({
        id,
        source: sourceCopy.buffer,
        width,
        height,
        stroke,
        selection: selectionCopy?.buffer ?? null
      }, selectionCopy ? [sourceCopy.buffer, selectionCopy.buffer] : [sourceCopy.buffer]);
    });
  }

  getWorker() {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.workerFactory?.();
      if (!this.worker) return null;
      this.worker.addEventListener('message', event => this.handleMessage(event));
      this.worker.addEventListener('error', () => this.disableWorker());
      return this.worker;
    } catch {
      this.failed = true;
      return null;
    }
  }

  handleMessage(event) {
    const { id, ok, result, error } = event.data ?? {};
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error || 'Worker retuszu zakończył się błędem.'));
  }

  disableWorker() {
    this.failed = true;
    this.worker?.terminate?.();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Worker retuszu został zatrzymany.'));
    this.pending.clear();
  }

  dispose() {
    this.disableWorker();
  }
}

function defaultWorkerFactory() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./editor-retouch-worker.js', import.meta.url), { type: 'module', name: 'localstudio-retouch' });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException(String(reason || 'Retusz anulowany.'), 'AbortError');
}
