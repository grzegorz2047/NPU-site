import { exportBenchmarkReport } from './editor-inference-benchmark.js';

export class RuntimeDiagnosticsPanel {
  constructor({ root = document, engine = globalThis.localStudioInference } = {}) {
    this.root = root;
    this.engine = engine;
    ensureRuntimePanel(root);
    this.elements = this.resolveElements();
    this.bind();
    this.render();
  }

  resolveElements() {
    const get = id => this.root.getElementById(id);
    return {
      cancel: get('runtime-cancel'),
      export: get('runtime-export-report'),
      backend: get('runtime-backend-detail'),
      queue: get('runtime-queue-status'),
      models: get('runtime-model-list'),
      stages: get('runtime-stage-list'),
      ioBinding: get('runtime-io-binding')
    };
  }

  bind() {
    this.elements.cancel?.addEventListener('click', () => this.engine?.cancel());
    this.elements.export?.addEventListener('click', () => {
      const report = this.engine?.diagnostics()?.lastReport;
      if (report) exportBenchmarkReport(report);
    });
    this.root.addEventListener('localstudio:runtime-state', () => this.render());
  }

  render() {
    if (!this.engine) {
      this.engine = globalThis.localStudioInference;
      if (!this.engine) return;
    }
    const diagnostics = this.engine.diagnostics();
    const running = diagnostics.queue.running[0] ?? null;
    const pendingCount = diagnostics.queue.pending.length;
    const report = diagnostics.lastReport;
    const backend = report?.metadata?.actualBackend ?? this.engine.backend ?? null;
    const runningModel = running ? diagnostics.compatibility.find(model => model.id === running.metadata.modelId)?.name ?? running.metadata.modelId : null;

    if (this.elements.cancel) this.elements.cancel.disabled = !running;
    if (this.elements.export) this.elements.export.disabled = !report;
    if (this.elements.backend) {
      this.elements.backend.textContent = backend
        ? `${backendLabel(backend)}${report?.metadata?.fallbackUsed ? ' · tryb zapasowy' : ''}`
        : 'Nie uruchomiono zadania';
      this.elements.backend.dataset.tone = backend === 'npu' ? 'success' : backend ? 'warning' : 'neutral';
    }
    if (this.elements.queue) {
      this.elements.queue.textContent = running
        ? `W toku: ${runningModel} · ${formatProgress(running.progress)}${pendingCount ? ` · oczekuje ${pendingCount}` : ''}`
        : pendingCount ? `W kolejce: ${pendingCount}` : 'Kolejka pusta';
    }
    if (this.elements.ioBinding) {
      const npuSession = diagnostics.sessionDetails?.find(session => session.key.endsWith(':npu'));
      this.elements.ioBinding.textContent = npuSession
        ? npuSession.ioBinding ? 'Sesja NPU aktywna; API IO binding / MLTensor jest dostępne.' : 'Sesja NPU aktywna; API IO binding nie jest dostępne w tym runtime.'
        : 'IO binding: oczekuje na zgodną sesję NPU.';
    }
    this.renderModels(diagnostics.compatibility);
    this.renderStages(report?.stages);
  }

  renderModels(matrix) {
    const container = this.elements.models;
    if (!container) return;
    container.replaceChildren();
    for (const model of matrix) {
      const row = document.createElement('div');
      row.className = 'runtime-model-row';
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = model.name;
      const task = document.createElement('small');
      task.textContent = taskLabel(model.task);
      copy.append(name, task);
      const badges = document.createElement('span');
      badges.className = 'runtime-backend-badges';
      for (const backend of ['npu', 'webgpu', 'wasm']) {
        const badge = document.createElement('span');
        const contract = model.backends[backend];
        badge.textContent = shortBackend(backend);
        badge.title = contract.note || backend;
        badge.dataset.available = String(contract.available);
        badge.dataset.supported = String(contract.supported);
        badges.append(badge);
      }
      row.append(copy, badges);
      container.append(row);
    }
  }

  renderStages(stages) {
    const container = this.elements.stages;
    if (!container) return;
    container.replaceChildren();
    if (!stages) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Po pierwszej inferencji pojawi się rozbicie czasu na etapy.';
      container.append(empty);
      return;
    }
    for (const [stage, value] of Object.entries(stages)) {
      const row = document.createElement('div');
      row.className = 'runtime-stage-row';
      const label = document.createElement('span');
      label.textContent = stageLabel(stage);
      const duration = document.createElement('output');
      duration.textContent = `${Math.round(value.durationMs)} ms`;
      row.append(label, duration);
      container.append(row);
    }
  }
}

export function ensureRuntimePanel(root = document) {
  if (root.getElementById?.('runtime-diagnostics')) return;
  ensureStylesheet(root);
  const backendSelect = root.getElementById?.('backend-select');
  const body = backendSelect?.closest('details')?.querySelector('.section-body');
  if (!body) return;
  const init = root.getElementById?.('init-button');
  const actions = root.createElement('div');
  actions.className = 'runtime-actions';
  if (init) actions.append(init);
  actions.insertAdjacentHTML('beforeend', '<button id="runtime-cancel" class="panel-button" type="button" disabled>Anuluj zadanie</button>');
  body.append(actions);

  const queueStatus = root.createElement('p');
  queueStatus.id = 'runtime-queue-status';
  queueStatus.className = 'runtime-live-status';
  queueStatus.setAttribute('aria-live', 'polite');
  queueStatus.textContent = 'Kolejka pusta';
  body.append(queueStatus);

  const panel = root.createElement('details');
  panel.id = 'runtime-diagnostics';
  panel.className = 'runtime-diagnostics';
  panel.innerHTML = `
    <summary><span>Diagnostyka modeli</span><span id="runtime-backend-detail" class="badge" data-tone="neutral">Nie uruchomiono zadania</span></summary>
    <div class="runtime-diagnostics-body">
      <p id="runtime-io-binding" class="hint">IO binding: oczekuje na zgodną sesję NPU.</p>
      <div class="runtime-subheading"><strong>Modele i backendy</strong><small>zielony: dostępny · szary: wspierany · przerywany: niewspierany</small></div>
      <div id="runtime-model-list" class="runtime-model-list"></div>
      <div class="runtime-subheading"><strong>Ostatni benchmark</strong><button id="runtime-export-report" class="runtime-link-button" type="button" disabled>Eksport JSON</button></div>
      <div id="runtime-stage-list" class="runtime-stage-list"><p class="hint">Po pierwszej inferencji pojawi się rozbicie czasu na etapy.</p></div>
    </div>`;
  body.append(panel);
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-runtime-styles]')) return;
  const link = root.createElement('link');
  link.rel = 'stylesheet';
  link.href = './editor-runtime.css';
  link.dataset.editorRuntimeStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}

function backendLabel(backend) {
  return ({ npu: 'NPU / WebNN', webgpu: 'GPU / WebGPU', wasm: 'CPU / WASM' })[backend] ?? backend;
}

function shortBackend(backend) {
  return ({ npu: 'NPU', webgpu: 'GPU', wasm: 'CPU' })[backend] ?? backend;
}

function taskLabel(task) {
  return ({
    'background-removal': 'usuwanie tła',
    'depth-estimation': 'mapa głębi'
  })[task] ?? task;
}

function stageLabel(stage) {
  return ({
    download: 'Pobieranie / cache',
    preprocessing: 'Przygotowanie obrazu',
    'transfer-in': 'Transfer wejścia',
    inference: 'Inferencja',
    'transfer-out': 'Transfer wyniku',
    postprocessing: 'Przygotowanie wyniku'
  })[stage] ?? stage;
}

function formatProgress(progress) {
  if (!progress) return 'uruchamianie';
  if (Number.isFinite(progress.progress)) return `${Math.round(progress.progress)}%`;
  return progress.label || progress.stage || 'w toku';
}

if (typeof document !== 'undefined') new RuntimeDiagnosticsPanel();
