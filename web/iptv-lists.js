// Private IPTV list of each account (hosting/calamar-iptv.php?lista=…), managed from its page in
// Administración → Usuarios. The random id is the list's password; once its date passes it stops working.
export const IPTV_ENDPOINT = 'https://calamarmenciano.com/calamar-iptv.php';
// Short address (hosting/i/index.php): WisePlay's format, or M3U for other apps with «&m3u».
export const IPTV_SHORT = 'https://calamarmenciano.com/i/?';
// Lowercase letters and digits that cannot be mistaken for one another (no 0/o, 1/l/i), easy with a remote.
const LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const PASSWORD_LENGTH = 10;

export function iptvPassword(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  // 31 letters: bytes from 248 up are skipped so every letter is equally likely (31^10 ≈ 8·10^14 codes).
  let out = '';
  while (out.length < PASSWORD_LENGTH) for (const n of random(24)) if (n < 248 && out.length < PASSWORD_LENGTH) out += LETTERS[n % 31];
  return out;
}

export const iptvLink = token => `${IPTV_SHORT}${token}`;
export const iptvM3uLink = token => `${IPTV_SHORT}${token}&m3u`;

/** The moment the list stops working: the chosen day and hour in Spain (without an hour, at the end of that day). */
export function madridMoment(day, time = '') {
  const guess = new Date(`${day}T${/^\d{2}:\d{2}$/.test(time) ? time + ':00' : '23:59:59'}Z`);
  const at = zone => new Date(guess.toLocaleString('en-US', { timeZone: zone }));
  return new Date(guess.getTime() - (at('Europe/Madrid') - at('UTC')));
}

export const madridEndOfDay = day => madridMoment(day);
export const madridTime = date => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
export const madridDate = date => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function iptvState(list, now = Date.now()) {
  if (!list) return 'Esta cuenta no tiene lista IPTV.';
  if (!list.expires) return 'Lista activa, sin fecha de caducidad.';
  const day = list.expires.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' });
  const hour = madridTime(list.expires);
  return list.expires.getTime() <= now ? `Lista caducada el ${day} a las ${hour}: ya no funciona.` : `Lista activa hasta el ${day} a las ${hour} (hora de España).`;
}

/** The «Lista IPTV» section of a user's page. */
export function iptvSection(el, service, user) {
  const note = el('p', { class: 'note', role: 'status' }, 'Cargando lista IPTV…');
  const link = el('input', { type: 'text', readonly: true, 'aria-label': 'Enlace de la lista IPTV', class: 'iptv-link' });
  const date = el('input', { type: 'date', 'aria-label': 'Último día que funciona la lista' });
  const time = el('input', { type: 'time', step: '60', 'aria-label': 'Hora a la que deja de funcionar' });
  const button = (text, click) => el('button', { class: 'btn secondary', type: 'button', onclick: click }, text);
  let list = null;
  const expiry = () => (date.value ? madridMoment(date.value, time.value) : null);
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
  const clear = button('Sin fecha', () => { date.value = ''; time.value = ''; });
  const copy = button('Copiar enlace', async () => {
    try { await navigator.clipboard.writeText(link.value); note.textContent = 'Enlace copiado.'; }
    catch { link.select(); note.textContent = 'Selecciona el enlace y cópialo.'; }
  });
  const wiseplay = button('Copiar enlace para otras apps (M3U)', async () => {
    const address = iptvM3uLink(list.token);
    try { await navigator.clipboard.writeText(address); note.textContent = 'Enlace M3U copiado: para TiviMate, IPTV Smarters, VLC…'; }
    catch { note.textContent = address; }
  });
  const remove = button('Borrar lista', () => {
    if (!window.confirm('El enlace dejará de funcionar. ¿Borrar la lista IPTV?')) return;
    busy('Borrando…', async () => { await service.deleteIptvList(user.uid); list = null; date.value = ''; time.value = ''; });
  });
  const buttons = [create, save, clear, copy, wiseplay, remove];
  const draw = () => {
    link.value = list ? iptvLink(list.token) : '';
    link.hidden = copy.hidden = wiseplay.hidden = save.hidden = remove.hidden = !list;
    create.textContent = list ? 'Nueva contraseña' : 'Crear lista';
    note.textContent = iptvState(list);
  };
  for (const b of buttons) b.disabled = true;
  Promise.resolve().then(() => service.readIptvList(user.uid)).then(found => {
    list = found;
    if (list?.expires) { date.value = madridDate(list.expires); time.value = madridTime(list.expires); }
    draw();
    for (const b of buttons) b.disabled = false;
  }).catch(error => { note.textContent = service.explain(error); });
  return el('section', { class: 'user-surface iptv-list' },
    el('h2', {}, 'Lista IPTV'),
    el('p', { class: 'note' }, 'Enlace corto para WisePlay (carpetas, una por serie, con portada e iconos) con los canales, películas, series y documentales. Se actualiza sola.'),
    link,
    el('label', { class: 'iptv-date' }, el('span', {}, 'Caduca el día y a la hora (de España); sin hora, al acabar el día. Vacío: sin caducidad'), el('span', {}, date, time, clear)),
    el('div', { class: 'actions' }, create, save, copy, wiseplay, remove), note);
}

export const LIBRARY_FOLDERS = ['Películas', 'Series', 'Documentales'];

/** The folders of the list: the channel categories (as the web shows them), then films, series and documentaries. */
export function iptvFolders(channels = []) {
  const groups = [];
  for (const c of channels) if (c?.playable !== false && c?.group && !groups.includes(c.group)) groups.push(c.group);
  // A channel category called like a library folder keeps its own folder («Series (canales)»), as in the hosting.
  return [...groups.map(g => (LIBRARY_FOLDERS.includes(g) ? `${g} (canales)` : g)), ...LIBRARY_FOLDERS];
}

/** Only https icons of known folders are kept. */
export function cleanIcons(icons, folders) {
  const out = {};
  for (const name of folders) {
    const url = String(icons?.[name] || '').trim();
    if (/^https:\/\/\S+$/.test(url)) out[name] = url;
  }
  return out;
}

/** Administración → Lista IPTV: the icon of each folder of the list. */
export function iptvAdmin(el, service, state) {
  const status = el('p', { class: 'note', role: 'status' }, 'Cargando iconos…');
  const rows = el('div', { class: 'iptv-icons' });
  const folders = iptvFolders(state.channels);
  const inputs = new Map();
  const save = el('button', { class: 'btn', type: 'button', disabled: true }, 'Guardar iconos');
  const row = (name, url) => {
    const preview = el('img', { class: url ? 'iptv-icon-preview' : 'iptv-icon-preview empty', alt: '', src: url || null });
    const input = el('input', { type: 'url', placeholder: 'https://…', value: url || '', 'aria-label': `Icono de ${name}` });
    const show = () => { const ok = /^https:\/\/\S+$/.test(input.value.trim()); preview.classList.toggle('empty', !ok); if (ok) preview.src = input.value.trim(); };
    input.addEventListener('input', show);
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (!chosen) return;
      status.textContent = `Subiendo el icono de ${name}…`;
      try {
        const { coverFromFile } = await import('./image-file.js');
        input.value = await service.uploadIptvIcon(await coverFromFile(chosen, [256, 192, 128]));
        show();
        status.textContent = 'Icono subido. Pulsa «Guardar iconos».';
      } catch (error) { status.textContent = service.explain(error); }
    });
    inputs.set(name, input);
    return el('div', { class: 'iptv-icon-row' }, preview,
      el('b', {}, name), input,
      el('button', { class: 'btn secondary', type: 'button', onclick: () => file.click() }, 'Subir imagen'), file,
      el('button', { class: 'ghost', type: 'button', onclick: () => { input.value = ''; show(); } }, 'Quitar'));
  };
  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = 'Guardando…';
    try {
      // Icons of folders not shown now (a category without channels today) are kept.
      const icons = { ...(settings.icons || {}) };
      for (const name of folders) delete icons[name];
      Object.assign(icons, cleanIcons(Object.fromEntries([...inputs].map(([name, input]) => [name, input.value])), folders));
      settings = { ...settings, icons };
      await service.saveIptvSettings(settings);
      status.textContent = 'Guardado. Las listas los muestran la próxima vez que la app las actualice.';
    } catch (error) { status.textContent = service.explain(error); }
    finally { save.disabled = false; }
  });
  let settings = {};
  Promise.resolve().then(() => service.readIptvSettings()).then(found => {
    settings = found && typeof found === 'object' ? found : {};
    rows.replaceChildren(...folders.map(name => row(name, settings.icons?.[name])));
    status.textContent = '';
    save.disabled = false;
  }).catch(error => { status.textContent = service.explain(error); });
  return [el('section', { class: 'users-page iptv-admin' },
    el('a', { class: 'ghost user-back', href: '#/admin' }, '‹ Administración'),
    el('h1', {}, 'Lista IPTV'),
    el('p', { class: 'note' }, 'Icono de cada carpeta de la lista: las categorías de canales, Películas, Series y Documentales. Se ven en WisePlay con el enlace en su formato (&formato=wiseplay); las apps que leen «group-logo» también los muestran en la lista M3U.'),
    rows, el('div', { class: 'actions' }, save), status)];
}
