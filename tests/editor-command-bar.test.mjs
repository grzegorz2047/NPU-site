import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeCommandMenus, COMMAND_MENU_IDS, enabledMenuItems } from '../src/editor-command-bar.js';

test('command menus expose only enabled and visible actions to keyboard navigation', () => {
  const first = { disabled: false, hidden: false };
  const disabled = { disabled: true, hidden: false };
  const hidden = { disabled: false, hidden: true };
  const last = { disabled: false, hidden: false };
  const menu = { querySelectorAll: () => [first, disabled, hidden, last] };
  assert.deepEqual(enabledMenuItems(menu), [first, last]);
});

test('closing command menus preserves the selected exception and can restore focus', () => {
  let focused = 0;
  const menus = new Map(COMMAND_MENU_IDS.map((id, index) => [id, {
    open: true,
    querySelector: () => ({ focus: () => { focused += 1; } }),
    index
  }]));
  const root = { getElementById: id => menus.get(id) };
  closeCommandMenus(root, { except: menus.get(COMMAND_MENU_IDS[0]), restoreFocus: true });
  assert.equal(menus.get(COMMAND_MENU_IDS[0]).open, true);
  assert.equal(menus.get(COMMAND_MENU_IDS[1]).open, false);
  assert.equal(focused, 1);
});

test('editor keeps frequent commands visible and moves secondary actions into named menus', () => {
  const html = readFileSync(new URL('../editor.html', import.meta.url), 'utf8');
  assert.match(html, /data-command-bar="organized"/);
  assert.match(html, /id="file-command-menu"/);
  assert.match(html, /id="quick-command-menu"/);
  for (const id of ['browse-button', 'undo-button', 'redo-button', 'segment-button', 'download-button']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['sample-button', 'project-new', 'project-save', 'project-import', 'project-export', 'reset-button', 'preset-cv', 'preset-sticker', 'preset-blur']) {
    const position = html.indexOf(`id="${id}"`);
    assert.ok(position > html.indexOf('command-menu-popover'), `${id} should be inside a command menu`);
  }
});
