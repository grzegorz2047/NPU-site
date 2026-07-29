export function ensureCanvasUi(root = document) {
  ensureStylesheet(root);
  ensureToolButtons(root);
  ensureZoomControls(root);
  ensureCanvasLayers(root);
  ensureStatus(root);
  ensureInspectorPanels(root);
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-canvas-styles]')) return;
  const link = root.createElement('link');
  link.rel = 'stylesheet';
  link.href = './editor-canvas.css';
  link.dataset.editorCanvasStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}

function ensureToolButtons(root) {
  const rail = root.querySelector?.('.tool-rail');
  if (!rail || root.getElementById?.('hand-tool')) return;
  const fragment = html(root, `
    <button id="hand-tool" class="tool-button" type="button" title="Przesuwanie widoku (H lub spacja)"><span>✋</span><small>Ręka</small></button>
    <button id="crop-tool" class="tool-button" type="button" title="Kadrowanie (C)"><span>⌗</span><small>Kadr</small></button>
    <button id="transform-tool" class="tool-button" type="button" title="Transformacja warstwy (V)"><span>⤢</span><small>Transform</small></button>
    <span class="rail-separator"></span>`);
  rail.prepend(fragment);
}

function ensureZoomControls(root) {
  const toolbar = root.querySelector?.('.canvas-toolbar');
  const actions = toolbar?.querySelector('.canvas-actions');
  if (!toolbar || root.getElementById?.('zoom-value')) return;
  const controls = html(root, `
    <div class="zoom-controls" aria-label="Powiększenie płótna">
      <button id="zoom-out" type="button" title="Pomniejsz">−</button>
      <label><span class="sr-only">Powiększenie</span><input id="zoom-value" type="number" min="5" max="3200" value="100" /><small>%</small></label>
      <button id="zoom-in" type="button" title="Powiększ">＋</button>
      <button id="zoom-100" type="button">100%</button>
      <button id="zoom-fit" type="button">Dopasuj</button>
    </div>`);
  toolbar.insertBefore(controls, actions ?? null);
}

function ensureCanvasLayers(root) {
  const stage = root.getElementById?.('dropzone');
  const card = root.querySelector?.('.canvas-card');
  const stack = root.querySelector?.('.canvas-stack');
  if (!stage || !card || !stack) return;
  card.id ||= 'canvas-card';
  if (!root.getElementById?.('canvas-ruler-x')) {
    stage.prepend(html(root, `
      <canvas id="canvas-ruler-x" class="canvas-ruler canvas-ruler-x" width="640" height="20" aria-label="Linijka pozioma"></canvas>
      <canvas id="canvas-ruler-y" class="canvas-ruler canvas-ruler-y" width="20" height="480" aria-label="Linijka pionowa"></canvas>`));
  }
  if (!root.getElementById?.('canvas-ui-overlay')) {
    const overlay = root.createElement('canvas');
    overlay.id = 'canvas-ui-overlay';
    overlay.width = Number(root.getElementById?.('result-canvas')?.width) || 640;
    overlay.height = Number(root.getElementById?.('result-canvas')?.height) || 480;
    overlay.setAttribute('aria-hidden', 'true');
    stack.insertBefore(overlay, root.getElementById?.('result-empty') ?? null);
  }
}

function ensureStatus(root) {
  const status = root.querySelector?.('.status-bar');
  if (!status || root.getElementById?.('canvas-mode-status')) return;
  const mode = root.createElement('span');
  mode.id = 'canvas-mode-status';
  mode.textContent = 'Nawigacja · 100%';
  status.insertBefore(mode, root.getElementById?.('project-save-status') ?? status.children[1] ?? null);
}

function ensureInspectorPanels(root) {
  const inspector = root.querySelector?.('.inspector');
  if (!inspector || root.getElementById?.('grid-toggle')) return;
  const anchor = inspector.querySelector('.project-section');
  const fragment = html(root, `
    <details class="inspector-section canvas-settings-section" open>
      <summary>Widok i prowadnice</summary>
      <div class="section-body canvas-options">
        <label class="checkbox-row"><input id="grid-toggle" type="checkbox" /> Siatka</label>
        <label class="checkbox-row"><input id="guides-toggle" type="checkbox" checked /> Prowadnice</label>
        <label class="checkbox-row"><input id="snap-toggle" type="checkbox" checked /> Przyciąganie</label>
        <button id="clear-guides" class="panel-button" type="button">Wyczyść prowadnice</button>
        <p class="hint">Dwuklik na linijce dodaje prowadnicę, prawy przycisk usuwa najbliższą.</p>
      </div>
    </details>
    <details id="crop-controls" class="inspector-section" open hidden>
      <summary>Kadrowanie</summary>
      <div class="section-body">
        <label>Proporcje<select id="crop-ratio"><option value="free">Dowolne</option><option value="original">Oryginalne</option><option value="1">1:1</option><option value="1.333333">4:3</option><option value="1.5">3:2</option><option value="1.777778">16:9</option></select></label>
        <label>Kąt kadru<input id="crop-angle" type="number" min="-45" max="45" step="0.1" value="0" /></label>
        <div class="two-buttons"><button id="crop-apply" class="panel-button primary-panel" type="button">Zatwierdź</button><button id="crop-cancel" class="panel-button" type="button">Anuluj</button></div>
        <p class="hint">Przeciągnij obszar na płótnie. Kadrowanie zachowuje warstwy i maski do momentu zatwierdzenia.</p>
      </div>
    </details>
    <details id="transform-controls" class="inspector-section" open hidden>
      <summary>Transformacja warstwy</summary>
      <div class="section-body transform-grid">
        <div class="two-columns"><label>X<input id="transform-x" type="number" step="1" /></label><label>Y<input id="transform-y" type="number" step="1" /></label></div>
        <div class="two-columns"><label>Skala X<input id="transform-scale-x" type="number" min="0.01" step="0.01" /></label><label>Skala Y<input id="transform-scale-y" type="number" min="0.01" step="0.01" /></label></div>
        <label>Obrót<input id="transform-rotation" type="number" step="0.1" /></label>
        <div class="two-columns"><label>Skew X<input id="transform-skew-x" type="number" step="0.1" /></label><label>Skew Y<input id="transform-skew-y" type="number" step="0.1" /></label></div>
        <div class="two-columns"><label>Perspektywa X<input id="transform-perspective-x" type="number" min="-0.95" max="0.95" step="0.01" /></label><label>Perspektywa Y<input id="transform-perspective-y" type="number" min="-0.95" max="0.95" step="0.01" /></label></div>
        <label>Prostowanie horyzontu<input id="straighten-angle" type="range" min="-15" max="15" step="0.1" value="0" /></label>
        <div class="two-buttons"><button id="transform-apply" class="panel-button primary-panel" type="button">Zatwierdź</button><button id="transform-cancel" class="panel-button" type="button">Anuluj</button></div>
      </div>
    </details>
    <details class="inspector-section">
      <summary>Rozmiar dokumentu i warstwy</summary>
      <div class="section-body">
        <div class="two-columns"><label>Szerokość<input id="canvas-width" type="number" min="1" max="32768" value="640" /></label><label>Wysokość<input id="canvas-height" type="number" min="1" max="32768" value="480" /></label></div>
        <label>Interpolacja<select id="resize-interpolation"><option value="nearest">Najbliższy sąsiad</option><option value="low">Niska</option><option value="medium">Średnia</option><option value="high" selected>Wysoka</option></select></label>
        <label class="checkbox-row"><input id="resize-scale-layers" type="checkbox" checked /> Skaluj warstwy razem z dokumentem</label>
        <div class="two-buttons"><button id="resize-document" class="panel-button" type="button">Zmień dokument</button><button id="resize-layer" class="panel-button" type="button">Zmień warstwę</button></div>
      </div>
    </details>`);
  anchor?.after(fragment);
  if (!anchor) inspector.append(fragment);
}

function html(root, source) {
  const template = root.createElement('template');
  template.innerHTML = source.trim();
  return template.content;
}
