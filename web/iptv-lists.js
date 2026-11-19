// Private IPTV list of each account (hosting/calamar-iptv.php?lista=…), managed from its page in
// Administración → Usuarios. The random id is the list's password; once its date passes it stops working.
export const IPTV_ENDPOINT = 'https://calamarmenciano.com/calamar-iptv.php';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function iptvPassword(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  // 62 letters: bytes from 248 up are skipped so every letter is equally likely.
  let out = '';
  while (out.length < 32) for (const n of random(48)) if (n < 248 && out.length < 32) out += LETTERS[n % 62];
  return out;
}

export const iptvLink = token => `${IPTV_ENDPOINT}?lista=${token}`;

/** The chosen day (yyyy-mm-dd) is the last one the list works: it ends at 23:59:59 in Spain. */
export function madridEndOfDay(day) {
  const guess = new Date(`${day}T23:59:59Z`);
  const at = zone => new Date(guess.toLocaleString('en-US', { timeZone: zone }));
  return new Date(guess.getTime() - (at('Europe/Madrid') - at('UTC')));
}

export const madridDate = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function iptvState(list, now = Date.now()) {
  if (!list) return 'Esta cuenta no tiene lista IPTV.';
  if (!list.expires) return 'Lista activa, sin fecha de caducidad.';
  const day = list.expires.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' });
  return list.expires.getTime() <= now ? `Lista caducada el ${day}: ya no funciona.` : `Lista activa hasta el ${day} (incluido).`;
}

/** The «Lista IPTV» section of a user's page. */
export function iptvSection(el, service, user) {
  const note = el('p', { class: 'note', role: 'status' }, 'Cargando lista IPTV…');
  const link = el('input', { type: 'text', readonly: true, 'aria-label': 'Enlace de la lista IPTV', class: 'iptv-link' });
  const date = el('input', { type: 'date', 'aria-label': 'Último día que funciona la lista' });
  const button = (text, click) => el('button', { class: 'btn secondary', type: 'button', onclick: click }, text);
  let list = null;
  const expiry = () => (date.value ? madridEndOfDay(date.value) : null);
  const busy = async (text, action) => {
    for (const b of buttons) b.disabled = true;
    note.textContent = text;
    try { await action(); draw(); }
    catch (error) { note.textContent = service.explain(error); }
    finally { for (const b of buttons) b.disabled = false; }
  };
  const create = button('Crear lista', () => {
    if (list && !window.confirm('Se creará una contraseña nueva y el enlace anterior dejará de funcionar. ¿Continuar?')) return;
    busy('Creando lista…', async () => { list = await service.createIptvList(user.uid, iptvPassword(), expiry()); });
  });
  create.classList.remove('secondary');
  const save = button('Guardar caducidad', () => busy('Guardando…', async () => {
    list = await service.saveIptvExpiry(list.token, user.uid, expiry());
  }));
  const clear = button('Sin fecha', () => { date.value = ''; });
  const copy = button('Copiar enlace', async () => {
    try { await navigator.clipboard.writeText(link.value); note.textContent = 'Enlace copiado.'; }
    catch { link.select(); note.textContent = 'Selecciona el enlace y cópialo.'; }
  });
  const remove = button('Borrar lista', () => {
    if (!window.confirm('El enlace dejará de funcionar. ¿Borrar la lista IPTV?')) return;
    busy('Borrando…', async () => { await service.deleteIptvList(user.uid); list = null; date.value = ''; });
  });
  const buttons = [create, save, clear, copy, remove];
  const draw = () => {
    link.value = list ? iptvLink(list.token) : '';
    link.hidden = copy.hidden = save.hidden = remove.hidden = !list;
    create.textContent = list ? 'Nueva contraseña' : 'Crear lista';
    note.textContent = iptvState(list);
  };
  for (const b of buttons) b.disabled = true;
  Promise.resolve().then(() => service.readIptvList(user.uid)).then(found => {
    list = found;
    if (list?.expires) date.value = madridDate(list.expires);
    draw();
    for (const b of buttons) b.disabled = false;
  }).catch(error => { note.textContent = service.explain(error); });
  return el('section', { class: 'user-surface iptv-list' },
    el('h2', {}, 'Lista IPTV'),
    el('p', { class: 'note' }, 'Enlace para WisePlay y apps IPTV con los canales, películas, series y documentales. Se actualiza sola.'),
    link,
    el('label', { class: 'iptv-date' }, el('span', {}, 'Último día que funciona (vacío: sin caducidad)'), el('span', {}, date, clear)),
    el('div', { class: 'actions' }, create, save, copy, remove), note);
}
