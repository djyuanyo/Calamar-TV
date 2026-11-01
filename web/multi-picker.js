import { MULTI_MAX, multiKey, multiPlayable } from './multi-view.js';
const norm = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
export const availableMultiEvents = events => events.filter(e => e.event && multiPlayable(e));
export const searchMultiEvents = (events, query) => events.filter(e => norm(e.name).includes(norm(query.trim())));
let picker = null;
export function closeMultiPicker() { picker?.close(); }

/** The current player keeps running while the viewer searches. No catalog mutations. */
export function pickMultiEvent({ events, selected, onChoose, parent = document.fullscreenElement || document.body }) {
  closeMultiPicker();
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'multi-event-picker'; dialog.setAttribute('aria-labelledby', 'multi-event-picker-title');
  const title = Object.assign(document.createElement('h2'), { id: 'multi-event-picker-title', textContent: 'Añadir evento' });
  const count = Object.assign(document.createElement('p'), { className: 'note', textContent: `${selected.length} de ${MULTI_MAX} pantallas` });
  const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Buscar por nombre del evento' }); search.setAttribute('aria-label', 'Buscar evento para multipantalla');
  const list = document.createElement('div'); list.className = 'multi-event-list';
  const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Cancelar' });
  const candidates = availableMultiEvents(events), keys = new Set(selected.map(multiKey));
  const draw = () => {
    list.replaceChildren(); const found = searchMultiEvents(candidates, search.value);
    for (const event of found) {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'multi-event-choice' });
      button.setAttribute('aria-label', event.name); button.disabled = keys.has(multiKey(event)) || selected.length >= MULTI_MAX;
      const name = Object.assign(document.createElement('b'), { textContent: event.name });
      const meta = Object.assign(document.createElement('small'), { textContent: keys.has(multiKey(event)) ? 'Ya está en multipantalla' : event.meta || event.group || 'Añadir a multipantalla' });
      button.append(name, meta); button.addEventListener('click', () => { dialog.close(); onChoose(event); }); list.append(button);
    }
    if (!found.length) list.append(Object.assign(document.createElement('p'), { className: 'note', role: 'status', textContent: candidates.length ? 'No hay eventos con ese nombre.' : 'No hay eventos disponibles.' }));
  };
  search.addEventListener('input', draw); cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (picker === dialog) picker = null; dialog.remove(); previous?.focus?.({ preventScroll: true }); }, { once: true });
  dialog.addEventListener('click', e => { if (e.target === dialog && (e.clientX < dialog.getBoundingClientRect().left || e.clientX > dialog.getBoundingClientRect().right || e.clientY < dialog.getBoundingClientRect().top || e.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
  dialog.append(title, count, search, list, cancel); parent.append(dialog); picker = dialog; draw(); dialog.showModal(); search.focus(); return dialog;
}
