import { icon } from './player-controls.js';

export function mobileTimer({ userAgent = '', maxTouchPoints = 0 } = {}, platform = '') {
  if (platform === 'tizen' || /smart[- ]?tv|\bTizen\b|\bTV\b|AFT\w*|BRAVIA|Web0S|WebOS|CrKey|SHIELD/i.test(userAgent)) return false;
  return /Android|iPhone|iPod|iPad|Windows Phone/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/** Each open player owns one countdown. Closing the player cancels it. */
export function playbackTimer(parent, stop, { style = 'icon-btn', until = 0 } = {}) {
  const doc = parent.ownerDocument;
  if (!mobileTimer(navigator, doc.documentElement.dataset.platform)) return null;
  const button = Object.assign(doc.createElement('button'), { type: 'button', className: style, title: 'Temporizador' });
  button.append(icon('timer'));
  parent.append(button);
  let deadline = until, timeout = null, dialog = null, note = null;

  const paint = () => {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    button.setAttribute('aria-label', deadline ? `Temporizador · ${remaining}` : 'Temporizador');
    button.setAttribute('aria-pressed', String(!!deadline));
    if (note && deadline) note.textContent = `Tiempo restante · ${remaining}`;
  };
  const cancel = () => {
    deadline = 0;
    clearTimeout(timeout);
    doc.removeEventListener('visibilitychange', tick);
    dialog?.close();
    paint();
  };
  const tick = () => {
    clearTimeout(timeout);
    if (!deadline) return;
    if (!parent.isConnected) { cancel(); return; }
    if (Date.now() >= deadline) {
      cancel();
      stop();
      return;
    }
    paint();
    timeout = setTimeout(tick, Math.min(1000, deadline - Date.now()));
  };
  const createButton = (text, type = 'button') => Object.assign(doc.createElement('button'), {
    type, textContent: text, className: type === 'submit' ? 'btn' : 'ghost',
  });
  button.addEventListener('click', () => {
    if (dialog) return;
    const panel = dialog = doc.createElement('dialog');
    panel.className = 'sleep-dialog';
    panel.setAttribute('aria-label', 'Temporizador');
    const title = doc.createElement('h2');
    title.textContent = 'Temporizador';
    const status = note = doc.createElement('p');
    status.textContent = 'Al terminar se detendrá la reproducción.';
    const form = doc.createElement('form');
    const label = doc.createElement('label');
    label.textContent = 'Minutos';
    const input = Object.assign(doc.createElement('input'), { type: 'number', min: 1, max: 720, step: 1, required: true, inputMode: 'numeric', value: 30 });
    label.append(input);
    const presets = doc.createElement('div');
    presets.className = 'sleep-actions';
    for (const minutes of [15, 30, 45, 60, 90, 120]) {
      const preset = createButton(`${minutes} min`);
      preset.onclick = () => { input.value = minutes; };
      presets.append(preset);
    }
    const actions = doc.createElement('div');
    actions.className = 'sleep-actions';
    const close = createButton('Cerrar');
    close.onclick = () => panel.close();
    actions.append(createButton(deadline ? 'Cambiar' : 'Iniciar', 'submit'), close);
    if (deadline) {
      const reset = createButton('Cancelar temporizador');
      reset.onclick = cancel;
      actions.append(reset);
    }
    form.append(label, presets, actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const minutes = input.valueAsNumber;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) return;
      deadline = Date.now() + minutes * 60000;
      panel.close();
      doc.addEventListener('visibilitychange', tick);
      tick();
    });
    panel.append(title, status, form);
    panel.addEventListener('close', () => {
      panel.remove();
      if (dialog === panel) { dialog = null; note = null; }
    }, { once: true });
    paint();
    (doc.fullscreenElement || doc.body).append(panel);
    panel.showModal();
  });
  paint();
  if (deadline) {
    doc.addEventListener('visibilitychange', tick);
    timeout = setTimeout(tick, Math.max(0, Math.min(1000, deadline - Date.now())));
  }
  return { button, cancel, deadline: () => deadline, setDeadline: value => {
    deadline = value;
    if (!value) cancel();
    else { doc.addEventListener('visibilitychange', tick); tick(); }
  } };
}
