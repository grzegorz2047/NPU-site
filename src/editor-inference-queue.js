let queueSequence = 0;

export class InferenceQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, Math.trunc(Number(concurrency)) || 1);
    this.pending = [];
    this.running = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(run, { id = null, priority = 0, metadata = {} } = {}) {
    if (typeof run !== 'function') throw new TypeError('Zadanie kolejki wymaga funkcji wykonawczej.');
    const sequence = ++queueSequence;
    id ||= `inference-${sequence}`;
    if (this.pending.some(item => item.id === id) || this.running.has(id)) throw new Error(`Zadanie ${id} już istnieje.`);
    const controller = new AbortController();
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const task = {
      id,
      priority: Number(priority) || 0,
      sequence,
      metadata: clone(metadata),
      state: 'queued',
      progress: null,
      controller,
      run,
      resolve,
      reject,
      promise,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null
    };
    this.pending.push(task);
    this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    this.emit('queued', task);
    this.pump();
    return {
      id,
      promise,
      cancel: reason => this.cancel(id, reason),
      get state() { return task.state; }
    };
  }

  cancel(id, reason = 'Operacja anulowana przez użytkownika.') {
    const pendingIndex = this.pending.findIndex(task => task.id === id);
    if (pendingIndex >= 0) {
      const [task] = this.pending.splice(pendingIndex, 1);
      task.state = 'cancelled';
      task.finishedAt = Date.now();
      const error = abortError(reason);
      task.reject(error);
      this.emit('cancelled', task, error);
      return true;
    }
    const task = this.running.get(id);
    if (!task) return false;
    task.controller.abort(reason);
    return true;
  }

  cancelAll(reason) {
    for (const task of [...this.pending]) this.cancel(task.id, reason);
    for (const task of this.running.values()) this.cancel(task.id, reason);
  }

  snapshot() {
    return {
      concurrency: this.concurrency,
      pending: this.pending.map(publicTask),
      running: [...this.running.values()].map(publicTask)
    };
  }

  async pump() {
    while (this.running.size < this.concurrency && this.pending.length) {
      const task = this.pending.shift();
      this.running.set(task.id, task);
      task.state = 'running';
      task.startedAt = Date.now();
      this.emit('started', task);
      Promise.resolve().then(async () => {
        try {
          const result = await task.run({
            signal: task.controller.signal,
            reportProgress: progress => {
              task.progress = clone(progress);
              this.emit('progress', task);
            }
          });
          if (task.controller.signal.aborted) throw abortError(task.controller.signal.reason);
          task.state = 'completed';
          task.finishedAt = Date.now();
          task.resolve(result);
          this.emit('completed', task);
        } catch (error) {
          task.state = isAbort(error, task.controller.signal) ? 'cancelled' : 'failed';
          task.finishedAt = Date.now();
          task.reject(error);
          this.emit(task.state, task, error);
        } finally {
          this.running.delete(task.id);
          this.pump();
        }
      });
    }
  }

  emit(type, task, error = null) {
    const event = { type, task: publicTask(task), error, queue: this.snapshot() };
    for (const listener of this.listeners) listener(event);
  }
}

function publicTask(task) {
  return {
    id: task.id,
    priority: task.priority,
    metadata: clone(task.metadata),
    state: task.state,
    progress: clone(task.progress),
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  };
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException(String(reason || 'Operacja anulowana.'), 'AbortError');
}

function clone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
