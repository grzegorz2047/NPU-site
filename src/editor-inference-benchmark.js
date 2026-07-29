export const BENCHMARK_STAGES = Object.freeze(['download', 'preprocessing', 'transfer-in', 'inference', 'transfer-out', 'postprocessing']);

export class InferenceBenchmark {
  constructor({ now = () => performance.now(), metadata = {} } = {}) {
    this.now = now;
    this.metadata = clone(metadata);
    this.startedAt = new Date().toISOString();
    this.stages = {};
    this.events = [];
  }

  async measure(stage, operation) {
    const start = this.now();
    try {
      return await operation();
    } finally {
      this.add(stage, this.now() - start);
    }
  }

  add(stage, durationMs, detail = {}) {
    const duration = Math.max(0, Number(durationMs) || 0);
    const current = this.stages[stage] ?? { durationMs: 0, count: 0 };
    current.durationMs += duration;
    current.count += 1;
    this.stages[stage] = current;
    this.events.push({ stage, durationMs: duration, detail: clone(detail) });
  }

  report(extra = {}) {
    const stages = {};
    for (const stage of BENCHMARK_STAGES) stages[stage] = { ...(this.stages[stage] ?? { durationMs: 0, count: 0 }) };
    for (const [stage, value] of Object.entries(this.stages)) if (!stages[stage]) stages[stage] = { ...value };
    return {
      schemaVersion: 1,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      metadata: { ...clone(this.metadata), ...clone(extra) },
      stages,
      totalMs: Object.values(stages).reduce((sum, stage) => sum + stage.durationMs, 0),
      events: clone(this.events)
    };
  }
}

export function exportBenchmarkReport(report, { filename = 'localstudio-inference-report.json', documentRef = globalThis.document, urlRef = globalThis.URL } = {}) {
  const json = JSON.stringify(report, null, 2);
  if (!documentRef?.createElement || typeof Blob === 'undefined' || !urlRef?.createObjectURL) return json;
  const blob = new Blob([json], { type: 'application/json' });
  const anchor = documentRef.createElement('a');
  anchor.href = urlRef.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => urlRef.revokeObjectURL(anchor.href), 1000);
  return json;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
