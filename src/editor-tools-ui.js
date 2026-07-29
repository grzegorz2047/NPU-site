export function ensureToolsUi(root = document) {
  ensureStylesheet(root);
  ensureToolRail(root);
  ensureOverlay(root);
  ensurePanel(root);
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-tools-styles]')) return;
  const link = root.createElement('link');
  link.rel = 'stylesheet';
  link.href = './editor-tools.css';
  link.dataset.editorToolsStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}

function ensureToolRail(root) {
  const rail = root.querySelector?.('.tool-rail');
  if (!rail || root.getElementById?.('manual-select-tool')) return;
  const fragment = html(root, `
    <button id="manual-select-tool" class="tool-button manual-tool-button" data-manual-tool="select" type="button" title="Zaznaczenie (M)"><span>▣</span><small>Zaznacz</small></button>
    <button id="manual-brush-tool" class="tool-button manual-tool-button" data-manual-tool="brush" type="button" title="Pędzel (B)"><span>●</span><small>Pędzel</small></button>
    <button id="manual-eraser-tool" class="tool-button manual-tool-button" data-manual-tool="eraser" type="button" title="Gumka maskująca (E)"><span>◇</span><small>Gumka</small></button>
    <button id="manual-fill-tool" class="tool-button manual-tool-button" data-manual-tool="fill" type="button" title="Wiadro (F)"><span>▰</span><small>Wiadro</small></button>
    <button id="manual-gradient-tool" class="tool-button manual-tool-button" data-manual-tool="gradient" type="button" title="Gradient (G)"><span>◒</span><small>Gradient</small></button>
    <button id="manual-eyedropper-tool" class="tool-button manual-tool-button" data-manual-tool="eyedropper" type="button" title="Pipeta (I)"><span>⌞</span><small>Pipeta</small></button>
    <button id="manual-text-tool" class="tool-button manual-tool-button" data-manual-tool="text" type="button" title="Tekst (T)"><span>T</span><small>Tekst</small></button>
    <button id="manual-shape-tool" class="tool-button manual-tool-button" data-manual-tool="shape" type="button" title="Kształt (U)"><span>▱</span><small>Kształt</small></button>
    <span class="rail-separator manual-tools-separator"></span>`);
  const firstLegacyRecipe = rail.querySelector('.recipe-button');
  rail.insertBefore(fragment, firstLegacyRecipe ?? rail.firstChild);
}

function ensureOverlay(root) {
  const stack = root.querySelector?.('.canvas-stack');
  if (!stack || root.getElementById?.('manual-tools-overlay')) return;
  const overlay = root.createElement('canvas');
  overlay.id = 'manual-tools-overlay';
  overlay.width = Number(root.getElementById?.('result-canvas')?.width) || 640;
  overlay.height = Number(root.getElementById?.('result-canvas')?.height) || 480;
  overlay.setAttribute('aria-label', 'Obszar narzędzi manualnych');
  overlay.tabIndex = 0;
  stack.insertBefore(overlay, root.getElementById?.('result-empty') ?? null);
}

function ensurePanel(root) {
  const inspector = root.querySelector?.('.inspector');
  if (!inspector || root.getElementById?.('manual-tool-panel')) return;
  const fragment = html(root, `
    <details id="manual-tool-panel" class="inspector-section manual-tool-panel" open>
      <summary>Narzędzia manualne</summary>
      <div class="section-body manual-tool-body">
        <div class="manual-tool-heading"><strong id="manual-tool-name">Brak aktywnego narzędzia</strong><button id="manual-tool-close" type="button" title="Wyłącz narzędzie">×</button></div>

        <div data-tool-options="select" hidden>
          <label>Typ zaznaczenia<select id="selection-kind"><option value="rectangle">Prostokąt</option><option value="ellipse">Elipsa</option><option value="polygon">Lasso wielokątne</option><option value="freehand">Lasso swobodne</option><option value="wand">Magic wand</option></select></label>
          <label>Operacja<select id="selection-operation"><option value="replace">Zastąp</option><option value="add">Dodaj</option><option value="subtract">Odejmij</option><option value="intersect">Przetnij</option></select></label>
          <div class="wand-options"><label>Tolerancja<input id="wand-tolerance" type="range" min="0" max="255" value="24" /></label><label class="checkbox-row"><input id="wand-contiguous" type="checkbox" checked /> Tylko obszar ciągły</label><label class="checkbox-row"><input id="wand-antialias" type="checkbox" checked /> Anti-aliasing</label></div>
          <div class="selection-adjust-grid"><label>Promień<input id="selection-radius" type="number" min="1" max="100" value="4" /></label><button id="selection-feather" class="panel-button" type="button">Feather</button><button id="selection-expand" class="panel-button" type="button">Rozszerz</button><button id="selection-contract" class="panel-button" type="button">Zmniejsz</button></div>
          <div class="two-buttons"><button id="selection-invert" class="panel-button" type="button">Odwróć</button><button id="selection-clear" class="panel-button" type="button">Wyczyść</button></div>
          <p id="selection-status" class="hint">Brak zaznaczenia — operacje obejmują cały dokument.</p>
        </div>

        <div data-tool-options="brush eraser" hidden>
          <label><span>Rozmiar <output id="brush-size-output">24 px</output></span><input id="brush-size" type="range" min="1" max="300" value="24" /></label>
          <label><span>Twardość <output id="brush-hardness-output">70%</output></span><input id="brush-hardness" type="range" min="0" max="100" value="70" /></label>
          <label><span>Krycie <output id="brush-opacity-output">100%</output></span><input id="brush-opacity" type="range" min="1" max="100" value="100" /></label>
          <label><span>Spacing <output id="brush-spacing-output">20%</output></span><input id="brush-spacing" type="range" min="2" max="200" value="20" /></label>
          <label data-brush-color>Kolor<input id="tool-color-a" type="color" value="#111111" /></label>
          <p class="hint">Każde pociągnięcie jest jedną operacją undo. Gumka zapisuje maskę i nie usuwa oryginalnych pikseli.</p>
        </div>

        <div data-tool-options="fill gradient eyedropper" hidden>
          <div class="two-columns"><label>Kolor A<input id="fill-color-a" type="color" value="#31c48d" /></label><label>Kolor B<input id="fill-color-b" type="color" value="#ffffff" /></label></div>
          <label><span>Krycie <output id="fill-opacity-output">100%</output></span><input id="fill-opacity" type="range" min="1" max="100" value="100" /></label>
          <label data-fill-tolerance><span>Tolerancja wiadra <output id="fill-tolerance-output">24</output></span><input id="fill-tolerance" type="range" min="0" max="255" value="24" /></label>
          <label data-gradient-type>Typ gradientu<select id="gradient-type"><option value="linear">Liniowy</option><option value="radial">Radialny</option></select></label>
          <p id="sampled-color-status" class="hint">Pipeta pobiera kolor ze złożonego obrazu.</p>
        </div>

        <div data-tool-options="text" hidden>
          <label>Treść<textarea id="text-content" rows="3">Tekst</textarea></label>
          <label>Font<select id="text-font"><option value="sans-serif">Sans serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option><option value="system-ui">System UI</option></select></label>
          <div class="two-columns"><label>Rozmiar<input id="text-size" type="number" min="6" max="500" value="48" /></label><label>Kolor<input id="text-color" type="color" value="#ffffff" /></label></div>
          <div class="two-columns"><label>Grubość<select id="text-weight"><option value="400">Regular</option><option value="600">Semibold</option><option value="700">Bold</option></select></label><label>Wyrównanie<select id="text-align"><option value="left">Do lewej</option><option value="center">Środek</option><option value="right">Do prawej</option></select></label></div>
          <p class="hint">Kliknij płótno. Tekst pozostaje edytowalną warstwą.</p>
        </div>

        <div data-tool-options="shape" hidden>
          <label>Kształt<select id="shape-kind"><option value="rectangle">Prostokąt</option><option value="ellipse">Elipsa</option><option value="line">Linia</option><option value="arrow">Strzałka</option></select></label>
          <div class="two-columns"><label>Wypełnienie<input id="shape-fill" type="color" value="#31c48d" /></label><label>Obrys<input id="shape-stroke" type="color" value="#ffffff" /></label></div>
          <div class="two-columns"><label>Grubość obrysu<input id="shape-stroke-width" type="number" min="0" max="100" value="2" /></label><label>Zaokrąglenie<input id="shape-radius" type="number" min="0" max="500" value="0" /></label></div>
          <div class="two-columns"><label>Rozmycie cienia<input id="shape-shadow-blur" type="number" min="0" max="100" value="0" /></label><label>Kolor cienia<input id="shape-shadow-color" type="color" value="#000000" /></label></div>
          <div class="two-columns"><label>Cień X<input id="shape-shadow-x" type="number" min="-200" max="200" value="0" /></label><label>Cień Y<input id="shape-shadow-y" type="number" min="-200" max="200" value="0" /></label></div>
          <p class="hint">Przeciągnij po płótnie. Kształt pozostaje skalowalną warstwą.</p>
        </div>
      </div>
    </details>`);
  const canvasSection = inspector.querySelector('.canvas-settings-section');
  if (canvasSection) canvasSection.after(fragment);
  else inspector.append(fragment);
}

function html(root, source) {
  const template = root.createElement('template');
  template.innerHTML = source.trim();
  return template.content;
}
