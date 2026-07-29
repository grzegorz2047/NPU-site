const STORAGE_KEY = 'localstudio.inspector.tab';

export const INSPECTOR_TABS = Object.freeze([
  Object.freeze({ id: 'tool', label: 'Narzędzie', icon: '✦', description: 'Opcje aktywnego narzędzia' }),
  Object.freeze({ id: 'layers', label: 'Warstwy', icon: '▱', description: 'Warstwy i korekty' }),
  Object.freeze({ id: 'document', label: 'Dokument', icon: '▤', description: 'Projekt, widok i eksport' }),
  Object.freeze({ id: 'ai', label: 'AI', icon: '◎', description: 'Modele i zadania lokalne' })
]);

const TAB_IDS = new Set(INSPECTOR_TABS.map(tab => tab.id));
const TOOL_IDS = new Set(['manual-tool-panel', 'crop-controls', 'transform-controls', 'retouch-panel']);
const LAYER_IDS = new Set(['adjustments-panel']);
const AI_IDS = new Set(['smart-select-panel', 'depth-panel', 'restoration-panel']);

export function normalizeInspectorTab(value, fallback = 'layers') {
  return TAB_IDS.has(value) ? value : fallback;
}

export function classifyInspectorSection(section) {
  const id = String(section?.id || '');
  const summary = sectionSummary(section).toLowerCase();
  const classes = sectionClassNames(section);

  if (classes.has('layers-section') || LAYER_IDS.has(id)) return 'layers';
  if (TOOL_IDS.has(id)) return 'tool';
  if (AI_IDS.has(id) || summary === 'ai i dokument' || summary.includes('silnik ai')) return 'ai';
  if (
    classes.has('project-section') || classes.has('canvas-settings-section') ||
    summary.includes('projekty lokalne') || summary.includes('widok i prowadnice') ||
    summary.includes('rozmiar dokumentu') || summary === 'eksport'
  ) return 'document';
  return 'tool';
}

export function inspectorTabForControl(control) {
  if (!control) return null;
  const id = String(control.id || '');
  const dataset = control.dataset || {};
  const classes = sectionClassNames(control);

  if (dataset.manualTool != null || dataset.retouchTool != null || ['crop-tool', 'transform-tool'].includes(id)) return 'tool';
  if (['smart-select-tool', 'depth-tool', 'segment-button'].includes(id)) return 'ai';
  if (classes.has('layer-row') || id.startsWith('layer-') || id.startsWith('adjustment-')) return 'layers';
  if (id.startsWith('project-') || ['zoom-fit', 'zoom-100', 'download-button'].includes(id)) return 'document';
  return null;
}

export function installInspectorNavigation(root = document) {
  const inspector = root.querySelector?.('.inspector');
  if (!inspector) return null;
  if (inspector.dataset.inspectorNavigation === 'true') return inspector.__inspectorNavigation ?? null;

  ensureStylesheet(root);
  inspector.dataset.inspectorNavigation = 'true';

  const title = inspector.querySelector(':scope > .inspector-title') ?? inspector.querySelector('.inspector-title');
  const titleStrong = title?.querySelector('strong');
  const titleMeta = title?.querySelector('span');
  if (titleStrong) titleStrong.textContent = 'Panel';
  if (titleMeta) {
    titleMeta.id = 'inspector-tab-description';
    titleMeta.textContent = INSPECTOR_TABS[1].description;
  }

  const nav = root.createElement('div');
  nav.className = 'inspector-tabs';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Kategorie panelu bocznego');

  const content = root.createElement('div');
  content.className = 'inspector-tab-content';

  const buttons = new Map();
  const panels = new Map();

  for (const tab of INSPECTOR_TABS) {
    const button = root.createElement('button');
    button.type = 'button';
    button.id = `inspector-tab-${tab.id}`;
    button.className = 'inspector-tab';
    button.dataset.inspectorTab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `inspector-panel-${tab.id}`);
    button.setAttribute('aria-selected', 'false');
    button.tabIndex = -1;
    button.innerHTML = `<span class="inspector-tab-icon" aria-hidden="true">${tab.icon}</span><span>${tab.label}</span><i aria-hidden="true"></i>`;
    nav.append(button);
    buttons.set(tab.id, button);

    const panel = root.createElement('section');
    panel.id = `inspector-panel-${tab.id}`;
    panel.className = 'inspector-tab-panel';
    panel.dataset.inspectorPanel = tab.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.hidden = true;
    panels.set(tab.id, panel);
    content.append(panel);
  }

  const toolOverview = createOverview(root, 'tool', 'Brak aktywnego narzędzia', 'Wybierz narzędzie po lewej. Tutaj pojawią się tylko jego ustawienia.');
  const layerOverview = createOverview(root, 'layers', 'Warstwy dokumentu', 'Zaznacz warstwę, aby zmienić jej krycie, mieszanie lub dodać korektę.');
  const documentOverview = createOverview(root, 'document', 'Dokument i projekt', 'Rzadziej używane ustawienia są oddzielone od bieżącej edycji.');
  const aiOverview = createOverview(root, 'ai', 'Lokalne AI', 'Modele działają lokalnie. Uruchamiaj je dopiero, gdy są potrzebne.');
  panels.get('tool').append(toolOverview);
  panels.get('layers').append(layerOverview);
  panels.get('document').append(documentOverview);
  panels.get('ai').append(aiOverview);

  const existingSections = [...inspector.children].filter(node => node.matches?.('details.inspector-section'));
  inspector.append(nav, content);

  let routing = false;
  const routeSection = section => {
    if (!section?.matches?.('details.inspector-section')) return;
    const category = classifyInspectorSection(section);
    section.dataset.inspectorCategory = category;
    curateSection(section, category);
    if (section.parentElement !== panels.get(category)) panels.get(category).append(section);
  };

  routing = true;
  existingSections.forEach(routeSection);
  relocateBackgroundInput(root);
  routing = false;

  let activeTab = normalizeInspectorTab(readStoredTab(), 'layers');
  let lastContextKey = '';

  const selectTab = (tabId, { focus = false, persist = true } = {}) => {
    activeTab = normalizeInspectorTab(tabId, activeTab);
    for (const tab of INSPECTOR_TABS) {
      const selected = tab.id === activeTab;
      const button = buttons.get(tab.id);
      const panel = panels.get(tab.id);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
      if (selected && titleMeta) titleMeta.textContent = tab.description;
    }
    inspector.dataset.activeInspectorTab = activeTab;
    if (persist) storeTab(activeTab);
    if (focus) buttons.get(activeTab)?.focus();
  };

  const sync = ({ autoSwitch = true } = {}) => {
    const context = activeToolContext(root);
    setText(toolOverview.querySelector('strong'), context.title);
    setText(toolOverview.querySelector('p'), context.description);
    setData(toolOverview, 'tone', context.active ? 'active' : 'neutral');

    const manualPanel = root.getElementById?.('manual-tool-panel');
    if (manualPanel) setData(manualPanel, 'contextVisible', String(context.kind === 'manual'));
    const retouchPanel = root.getElementById?.('retouch-panel');
    if (retouchPanel) setData(retouchPanel, 'contextVisible', String(context.kind === 'retouch'));

    const layerName = root.getElementById?.('layers-selection')?.textContent?.trim();
    setText(layerOverview.querySelector('strong'), layerName && layerName !== 'Brak zaznaczenia' ? layerName : 'Warstwy dokumentu');

    const runtime = root.getElementById?.('runtime-badge');
    const capability = root.getElementById?.('capability-badge');
    const runtimeText = runtime?.textContent?.trim() || 'Silnik wyłączony';
    const capabilityText = capability?.textContent?.trim() || 'Sprawdzanie WebNN…';
    setText(aiOverview.querySelector('strong'), runtimeText);
    setText(aiOverview.querySelector('p'), capabilityText);
    setData(aiOverview, 'tone', runtime?.dataset?.tone || 'neutral');
    setData(buttons.get('ai'), 'tone', runtime?.dataset?.tone || 'neutral');

    const contextKey = `${context.kind}:${context.title}`;
    if (autoSwitch && context.active && contextKey !== lastContextKey) selectTab(context.tab, { persist: false });
    lastContextKey = contextKey;
  };

  nav.addEventListener('click', event => {
    const button = event.target.closest?.('[data-inspector-tab]');
    if (button) selectTab(button.dataset.inspectorTab, { focus: false });
  });
  nav.addEventListener('keydown', event => {
    const current = event.target.closest?.('[data-inspector-tab]');
    if (!current) return;
    const index = INSPECTOR_TABS.findIndex(tab => tab.id === current.dataset.inspectorTab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % INSPECTOR_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = INSPECTOR_TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(INSPECTOR_TABS[next].id, { focus: true });
  });

  const clickHandler = event => {
    const control = event.target.closest?.('button, .layer-row');
    const tab = inspectorTabForControl(control);
    if (tab) selectTab(tab, { persist: false });
  };
  root.addEventListener?.('click', clickHandler, true);

  const observer = typeof MutationObserver === 'function' ? new MutationObserver(records => {
    if (routing) return;
    routing = true;
    for (const record of records) {
      for (const node of record.addedNodes ?? []) {
        if (node.matches?.('details.inspector-section') && node.parentElement === inspector) routeSection(node);
      }
    }
    routing = false;
    sync();
  }) : null;
  observer?.observe(inspector, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-active', 'data-tone', 'hidden', 'class'] });

  selectTab(activeTab, { persist: false });
  sync({ autoSwitch: false });

  const controller = Object.freeze({
    selectTab,
    get activeTab() { return activeTab; },
    sync,
    destroy() { observer?.disconnect(); root.removeEventListener?.('click', clickHandler, true); }
  });
  inspector.__inspectorNavigation = controller;
  globalThis.localStudioInspector = controller;
  return controller;
}

function createOverview(root, kind, title, description) {
  const overview = root.createElement('div');
  overview.className = `inspector-overview inspector-overview-${kind}`;
  overview.dataset.tone = 'neutral';
  overview.innerHTML = `<span aria-hidden="true"></span><div><strong>${title}</strong><p>${description}</p></div>`;
  return overview;
}

function curateSection(section, category) {
  const summary = section.querySelector?.(':scope > summary') ?? section.querySelector?.('summary');
  const text = summary?.textContent?.trim() || '';
  if (text === 'AI i dokument') summary.textContent = 'Silnik AI';
  if (text === 'Rozmiar dokumentu i warstwy') summary.textContent = 'Rozmiar dokumentu';

  if (category === 'document') section.open = text === 'Eksport';
  if (category === 'ai') section.open = text === 'AI i dokument';
  if (category === 'layers') section.open = section.classList?.contains('layers-section');
  if (category === 'tool' && ['Korekta', 'Szybka korekta (zgodność)', 'Tło i kompozycja', 'Redakcja danych'].includes(text)) section.open = false;
}

function relocateBackgroundInput(root) {
  const field = root.getElementById?.('background-input')?.closest?.('label');
  if (!field) return;
  const composition = [...(root.querySelectorAll?.('details.inspector-section') ?? [])].find(section => sectionSummary(section) === 'Tło i kompozycja');
  const body = composition?.querySelector?.('.section-body');
  if (body && field.parentElement !== body) body.append(field);
}

function activeToolContext(root) {
  const crop = root.getElementById?.('crop-controls');
  if (crop && !crop.hidden) return { active: true, kind: 'canvas', tab: 'tool', title: 'Kadrowanie', description: 'Ustaw proporcje, kąt i zatwierdź nowy kadr.' };
  const transform = root.getElementById?.('transform-controls');
  if (transform && !transform.hidden) return { active: true, kind: 'canvas', tab: 'tool', title: 'Transformacja warstwy', description: 'Przesuń, obróć albo przeskaluj aktywną warstwę.' };
  const retouch = root.getElementById?.('retouch-panel');
  if (retouch?.dataset?.active === 'true') {
    const title = root.getElementById?.('retouch-active-tool')?.textContent?.trim() || 'Retusz lokalny';
    return { active: true, kind: 'retouch', tab: 'tool', title, description: 'Parametry próbki i pędzla dotyczą bieżącego retuszu.' };
  }
  const manualName = root.getElementById?.('manual-tool-name')?.textContent?.trim();
  if (manualName && manualName !== 'Brak aktywnego narzędzia') return { active: true, kind: 'manual', tab: 'tool', title: manualName, description: 'Ustawienia poniżej dotyczą wyłącznie aktywnego narzędzia.' };
  const smart = root.getElementById?.('smart-select-panel');
  if (smart?.dataset?.active === 'true') return { active: true, kind: 'smart', tab: 'ai', title: 'Smart Select', description: 'Analiza obiektów i dopracowanie maski.' };
  const depth = root.getElementById?.('depth-panel');
  if (depth?.dataset?.active === 'true') return { active: true, kind: 'depth', tab: 'ai', title: 'Głębia i światło', description: 'Mapa głębi, punkt ostrości i efekty przestrzenne.' };
  return { active: false, kind: 'none', tab: 'tool', title: 'Brak aktywnego narzędzia', description: 'Wybierz narzędzie po lewej. Tutaj pojawią się tylko jego ustawienia.' };
}

function sectionSummary(section) {
  return section?.querySelector?.(':scope > summary')?.textContent?.trim() ?? section?.querySelector?.('summary')?.textContent?.trim() ?? section?.summary ?? '';
}

function sectionClassNames(element) {
  if (!element) return new Set();
  if (element.classList && typeof element.classList[Symbol.iterator] === 'function') return new Set(element.classList);
  return new Set(String(element.className || '').split(/\s+/).filter(Boolean));
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setData(element, key, value) {
  if (element && element.dataset?.[key] !== value) element.dataset[key] = value;
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-inspector-styles]')) return;
  const link = root.createElement('link');
  link.rel = 'stylesheet';
  link.href = './editor-inspector.css';
  link.dataset.editorInspectorStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}

function readStoredTab() {
  try { return globalThis.sessionStorage?.getItem(STORAGE_KEY); } catch { return null; }
}

function storeTab(tab) {
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, tab); } catch {}
}
