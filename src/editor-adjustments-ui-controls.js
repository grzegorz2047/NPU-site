import { ADJUSTMENT_SCHEMAS, ADJUSTMENT_TYPES } from './editor-adjustments.js';

export function ensureAdjustmentPanel(root = document) {
  if (root.getElementById?.('adjustments-panel')) return;
  ensureStylesheet(root);
  const inspector = root.querySelector?.('.inspector');
  if (!inspector) return;
  const legacy = [...inspector.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent.trim() === 'Korekta');
  if (legacy) {
    legacy.open = false;
    legacy.querySelector('summary').textContent = 'Szybka korekta (zgodność)';
  }
  const panel = root.createElement('details');
  panel.id = 'adjustments-panel';
  panel.className = 'inspector-section adjustments-section';
  panel.open = true;
  panel.innerHTML = `
    <summary>Korekty niedestrukcyjne</summary>
    <div class="section-body adjustments-panel-body">
      <div class="adjustment-add-row">
        <label>Typ korekty<select id="adjustment-type">${ADJUSTMENT_TYPES.map(type => `<option value="${type}">${ADJUSTMENT_SCHEMAS[type].label}</option>`).join('')}</select></label>
        <button id="adjustment-add" class="panel-button" type="button">Dodaj warstwę</button>
      </div>
      <p id="adjustment-active" class="adjustment-active">Wybierz warstwę korekcyjną albo dodaj nową.</p>
      <div id="adjustment-controls" class="adjustment-controls"></div>
      <div class="adjustment-mask-actions">
        <button id="adjustment-mask-selection" class="panel-button" type="button" disabled>Maska z zaznaczenia</button>
        <button id="adjustment-mask-full" class="panel-button" type="button" disabled>Pełny obraz</button>
      </div>
      <button id="adjustment-before" class="panel-button adjustment-before" type="button" disabled>Przytrzymaj, aby zobaczyć „przed”</button>
      <details class="adjustment-subsection" open>
        <summary>Histogram i clipping</summary>
        <div class="adjustment-subsection-body">
          <label class="adjustment-clipping-label"><input id="adjustment-clipping" type="checkbox" /> Pokaż ostrzeżenia clippingu</label>
          <canvas id="adjustment-histogram" class="adjustment-histogram" width="256" height="92" aria-label="Histogram RGB i luminancji"></canvas>
          <p id="adjustment-clipping-status" class="hint">Cienie 0.0% · światła 0.0%</p>
        </div>
      </details>
      <details class="adjustment-subsection">
        <summary>Presety</summary>
        <div class="adjustment-subsection-body adjustment-presets">
          <label>Preset<select id="adjustment-preset"><option value="">Wybierz preset…</option></select></label>
          <div class="adjustment-preset-buttons">
            <button id="adjustment-preset-apply" class="panel-button" type="button" disabled>Zastosuj</button>
            <button id="adjustment-preset-delete" class="panel-button" type="button" disabled>Usuń</button>
          </div>
          <div class="adjustment-preset-save">
            <input id="adjustment-preset-name" type="text" maxlength="60" placeholder="Nazwa własnego presetu" aria-label="Nazwa własnego presetu" />
            <button id="adjustment-preset-save" class="panel-button" type="button" disabled>Zapisz</button>
          </div>
        </div>
      </details>
    </div>`;
  if (legacy) inspector.insertBefore(panel, legacy);
  else inspector.append(panel);
}

export function createRangeControl(definition, value, onInput) {
  const label = document.createElement('label');
  label.className = 'adjustment-range';
  const heading = document.createElement('span');
  const name = document.createElement('span');
  name.textContent = definition.label;
  const output = document.createElement('output');
  output.textContent = formatValue(value, definition.step);
  heading.append(name, output);
  const row = document.createElement('span');
  row.className = 'adjustment-range-row';
  const input = document.createElement('input');
  input.type = 'range'; input.min = definition.min; input.max = definition.max; input.step = definition.step; input.value = value;
  const number = document.createElement('input');
  number.type = 'number'; number.min = definition.min; number.max = definition.max; number.step = definition.step; number.value = value;
  const update = raw => {
    const next = clamp(Number(raw), Number(definition.min), Number(definition.max));
    input.value = next; number.value = next; output.textContent = formatValue(next, definition.step); onInput(next);
  };
  input.addEventListener('input', () => update(input.value));
  number.addEventListener('change', () => update(number.value));
  row.append(input, number); label.append(heading, row);
  return label;
}

export function createSelectControl(labelText, values, current, labels, onChange) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value; option.textContent = labels[value] ?? value; select.append(option);
  }
  select.value = current;
  select.addEventListener('change', () => onChange(select.value));
  label.append(select);
  return label;
}

export function drawCurveEditor(canvas, points, channel) {
  const context = canvas.getContext('2d');
  const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#181818'; context.fillRect(0, 0, width, height);
  context.strokeStyle = '#333'; context.lineWidth = 1;
  for (let step = 1; step < 4; step += 1) {
    const x = width * step / 4; const y = height * step / 4;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  context.strokeStyle = ({ red: '#ff7f87', green: '#70df9f', blue: '#7caeff', rgb: '#f1f1f1' })[channel];
  context.lineWidth = 2; context.beginPath();
  points.forEach((point, index) => {
    const x = point[0] / 255 * width; const y = height - point[1] / 255 * height;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
  for (const point of points) {
    const x = point[0] / 255 * width; const y = height - point[1] / 255 * height;
    context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill(); context.strokeStyle = '#111'; context.stroke();
  }
}

export function curvePointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round(clamp((event.clientX - rect.left) / rect.width * 255, 0, 255)),
    y: Math.round(clamp((rect.bottom - event.clientY) / rect.height * 255, 0, 255))
  };
}

export function nearestCurvePoint(points, x, y, maxDistance) {
  let best = -1; let distance = maxDistance;
  for (let index = 0; index < points.length; index += 1) {
    const current = Math.hypot(points[index][0] - x, points[index][1] - y);
    if (current <= distance) { distance = current; best = index; }
  }
  return best;
}

export function drawHistogram(canvas, histogram) {
  const context = canvas.getContext('2d');
  const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height); context.fillStyle = '#171717'; context.fillRect(0, 0, width, height);
  const draw = (values, color, alpha) => {
    context.beginPath(); context.moveTo(0, height);
    for (let index = 0; index < values.length; index += 1) context.lineTo(index / (values.length - 1) * width, height - values[index] / histogram.max * (height - 4));
    context.lineTo(width, height); context.closePath(); context.globalAlpha = alpha; context.fillStyle = color; context.fill(); context.globalAlpha = 1;
  };
  draw(histogram.channels.red, '#ff5f68', 0.35); draw(histogram.channels.green, '#55d890', 0.35); draw(histogram.channels.blue, '#619eff', 0.35);
  context.strokeStyle = '#e8e8e8'; context.lineWidth = 1; context.beginPath();
  histogram.channels.luminance.forEach((value, index) => {
    const x = index / (histogram.channels.luminance.length - 1) * width; const y = height - value / histogram.max * (height - 4);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

export function ensureClippingOverlay(root, sourceCanvas) {
  const stack = sourceCanvas?.closest?.('.canvas-stack');
  if (!stack) return null;
  let overlay = root.getElementById('adjustment-clipping-overlay');
  if (!overlay) {
    overlay = root.createElement('canvas'); overlay.id = 'adjustment-clipping-overlay'; overlay.setAttribute('aria-hidden', 'true'); stack.append(overlay);
  }
  return overlay;
}

function ensureStylesheet(root) {
  if (root.querySelector?.('link[data-editor-adjustments-styles]')) return;
  const link = root.createElement('link'); link.rel = 'stylesheet'; link.href = './editor-adjustments.css'; link.dataset.editorAdjustmentsStyles = 'true';
  (root.head ?? root.documentElement)?.append(link);
}
function formatValue(value, step) { return Number(step) < 1 ? Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(Number(value))); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
