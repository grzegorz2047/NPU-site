export const COMMAND_MENU_IDS = Object.freeze(['file-command-menu', 'quick-command-menu']);

export function enabledMenuItems(menu) {
  return [...(menu?.querySelectorAll?.('.command-menu-item') ?? [])].filter(item => !item.disabled && !item.hidden);
}

export function closeCommandMenus(root = document, { except = null, restoreFocus = false } = {}) {
  for (const id of COMMAND_MENU_IDS) {
    const menu = root.getElementById?.(id);
    if (!menu || menu === except || !menu.open) continue;
    menu.open = false;
    if (restoreFocus) menu.querySelector('summary')?.focus?.();
  }
}

export function installCommandBar(root = document) {
  const bar = root.querySelector?.('.command-bar[data-command-bar="organized"]');
  if (!bar || bar.dataset.commandBarReady === 'true') return null;
  bar.dataset.commandBarReady = 'true';
  const menus = COMMAND_MENU_IDS.map(id => root.getElementById?.(id)).filter(Boolean);

  const onToggle = event => {
    const menu = event.currentTarget;
    if (menu.open) closeCommandMenus(root, { except: menu });
    menu.querySelector('summary')?.setAttribute('aria-expanded', String(menu.open));
  };
  const onSummaryKey = event => {
    const menu = event.currentTarget.closest('details');
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      menu.open = true;
      enabledMenuItems(menu)[0]?.focus();
    }
  };
  const onMenuKey = event => {
    const menu = event.currentTarget;
    const items = enabledMenuItems(menu);
    const index = items.indexOf(root.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary')?.focus();
      return;
    }
    const moves = { ArrowDown: 1, ArrowUp: -1 };
    if (moves[event.key] && items.length) {
      event.preventDefault();
      items[(index + moves[event.key] + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' && items.length) {
      event.preventDefault(); items[0].focus();
    } else if (event.key === 'End' && items.length) {
      event.preventDefault(); items.at(-1).focus();
    }
  };
  const onBarClick = event => {
    if (event.target.closest?.('.command-menu-item')) queueMicrotask(() => closeCommandMenus(root));
  };
  const onOutsidePointer = event => {
    if (!bar.contains(event.target)) closeCommandMenus(root);
  };
  const onRootKey = event => {
    if (event.key === 'Escape' && menus.some(menu => menu.open)) closeCommandMenus(root, { restoreFocus: true });
  };

  for (const menu of menus) {
    const summary = menu.querySelector('summary');
    summary?.setAttribute('aria-haspopup', 'menu');
    summary?.setAttribute('aria-expanded', String(menu.open));
    menu.addEventListener('toggle', onToggle);
    menu.addEventListener('keydown', onMenuKey);
    summary?.addEventListener('keydown', onSummaryKey);
  }
  bar.addEventListener('click', onBarClick);
  root.addEventListener?.('pointerdown', onOutsidePointer);
  root.addEventListener?.('keydown', onRootKey);

  return {
    destroy() {
      for (const menu of menus) {
        const summary = menu.querySelector('summary');
        menu.removeEventListener('toggle', onToggle);
        menu.removeEventListener('keydown', onMenuKey);
        summary?.removeEventListener('keydown', onSummaryKey);
      }
      bar.removeEventListener('click', onBarClick);
      root.removeEventListener?.('pointerdown', onOutsidePointer);
      root.removeEventListener?.('keydown', onRootKey);
      delete bar.dataset.commandBarReady;
    }
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => installCommandBar(document), { once: true });
  else installCommandBar(document);
}
