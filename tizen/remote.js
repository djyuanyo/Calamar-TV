const directions = { ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowDown: [0, 1] };
const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]';

function currentPanel() {
  return document.querySelector('dialog[open], .profile-gate') ||
    document.querySelector('#player:not([hidden]), .multi[aria-modal="true"]') || document;
}

function moveFocus(panel, active, [dx, dy]) {
  const candidates = [...panel.querySelectorAll(focusable)].filter(node =>
    node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[hidden], [inert], [aria-hidden="true"]')
      && node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
  if (!candidates.includes(active)) {
    candidates[0]?.focus();
    return;
  }
  const from = active.getBoundingClientRect();
  const x = from.left + from.width / 2, y = from.top + from.height / 2;
  let closest, best = Infinity;
  for (const node of candidates) {
    if (node === active) continue;
    const to = node.getBoundingClientRect();
    const tx = to.left + to.width / 2 - x, ty = to.top + to.height / 2 - y;
    const forward = tx * dx + ty * dy;
    if (forward <= 1) continue;
    const across = Math.abs(tx * dy + ty * dx);
    const distance = forward + across * 3;
    if (distance < best) { best = distance; closest = node; }
  }
  closest?.focus();
}

export function setupTizenRemote() {
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const dialog = [...document.querySelectorAll('dialog[open]')].pop();
    if (event.key === 'GoBack' || event.keyCode === 10009) {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (dialog) dialog.close();
      else if (document.querySelector('#player:not([hidden])')) document.getElementById('player-close').click();
      else if (location.hash && location.hash !== '#/') {
        if (history.length > 1) history.back();
        else location.hash = '#/';
      } else if (typeof tizen !== 'undefined') tizen.application.getCurrentApplication().exit();
      return;
    }
    const direction = directions[event.key];
    const active = document.activeElement;
    if (!direction || active?.matches('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    moveFocus(dialog || currentPanel(), active, direction);
  });
}
