import { el, fetchJson } from './app.js';
import { GROUP_ORDER, OWN_GROUP, merge } from './catalog.js';
import { ADMIN_EMAIL, validCover } from './shared-catalog.js';
import { auth, ready, administrator, watchAuth, login, logout, readCatalog, publishCatalog, explain } from './firebase.js';

let saving = false;
let file = null;
let notice = '';
let watching = false;
let fallbackLoaded = false;
let fallback = { featured: [], hidden: [], channels: [] };
async function loadFile() { file = await readCatalog(fallback); }
async function saveFile() {
  if (saving) throw new Error('Espera a que termine la publicación.');
  saving = true;
  try {
    file.revision = await publishCatalog(file.data, file.revision);
    notice = 'Guardado. Los cambios ya están publicados para la web y la app.';
  } catch (error) {
    // Never keep an unsuccessful mutation in the editor or show it as published.
    try { await loadFile(); } catch { file = null; }
    throw error;
  } finally { saving = false; }
}

function field(label, input, hint) {
  return el('label', {}, label, input, hint ? el('small', {}, hint) : null);
}

function loginView(rerender) {
  const status = el('p', { class: 'note', role: 'status' }, notice);
  const button = el('button', { class: 'btn', type: 'button', onclick: async () => {
    button.disabled = true;
    status.textContent = 'Abriendo Google…';
    try {
      await login();
      if (!administrator()) throw new Error(`Solo ${ADMIN_EMAIL} puede administrar los canales.`);
      await loadFile();
      notice = '';
      rerender();
    } catch (error) {
      status.textContent = explain(error);
      status.className = 'error';
    } finally { button.disabled = false; }
  } }, 'Continuar con Google');
  return [el('section', { class: 'panel' }, el('h1', {}, 'Administración'),
    el('p', { class: 'lead' }, `Entra con ${ADMIN_EMAIL} para publicar canales y eventos en todos tus dispositivos.`),
    button, auth.currentUser ? el('button', { class: 'ghost', onclick: async () => { await logout(); file = null; rerender(); } }, 'Cerrar sesión') : null, status)];
}

function slug(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canal';
}

function validStreams(text) {
  const out = [];
  for (const line of text.split(/\s+/)) {
    if (!line) continue;
    let url;
    try {
      url = new URL(line);
    } catch {
      throw new Error(`Enlace no válido: ${line}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Solo se admiten enlaces http(s): ${line}`);
    if (!out.includes(url.href)) out.push(url.href);
  }
  if (!out.length) throw new Error('Añade al menos un enlace');
  return out;
}

function channelForm(existing, rerender) {
  const data = file.data;
  const name = el('input', { required: true, value: existing ? existing.name : '' });
  const groupList = el('datalist', { id: 'groups' }, GROUP_ORDER.map((g) => el('option', { value: g })));
  const group = el('input', { list: 'groups', value: existing ? existing.group || OWN_GROUP : OWN_GROUP });
  const logo = el('input', { type: 'url', placeholder: 'https://…/logo.png', value: existing ? existing.logo || '' : '' });
  const streams = el('textarea', { required: true, placeholder: 'https://servidor/canal/index.m3u8', spellcheck: 'false' }, existing ? (existing.streams || []).join('\n') : '');
  const star = el('input', { type: 'checkbox', checked: existing ? data.featured.includes(existing.id) : false });
  const status = el('p', { class: 'note', 'aria-live': 'polite' });
  return el(
    'form',
    {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (saving) return;
        try {
          const channel = {
            id: existing ? existing.id : `mio-${slug(name.value)}-${Date.now().toString(36)}`,
            name: name.value.trim(),
            group: group.value.trim() || OWN_GROUP,
            logo: logo.value.trim().startsWith('https://') ? logo.value.trim() : '',
            streams: validStreams(streams.value),
          };
          if (!channel.name) throw new Error('Escribe el nombre del canal.');
          if (existing) data.channels[data.channels.findIndex((c) => c.id === existing.id)] = channel;
          else data.channels.push(channel);
          data.featured = data.featured.filter((id) => id !== channel.id);
          if (star.checked) data.featured.unshift(channel.id);
          status.textContent = 'Guardando…';
          await saveFile(`admin: ${existing ? 'editar' : 'añadir'} ${channel.name}`);
          rerender();
        } catch (err) {
          status.textContent = explain(err);
          status.className = 'error';

        }
      },
    },
    el('h2', {}, existing ? `Editar ${existing.name}` : 'Crear canal'),
    field('Nombre', name, 'Por ejemplo «Canal Menciana».'),
    field('Categoría', group, 'Elige una o escribe una nueva. Por defecto: Calamar TV.'),
    groupList,
    field('Logo (opcional)', logo),
    field('Enlaces', streams, 'Uno por línea. La web reproduce .m3u8 y .ts por HTTPS, y los enlaces TS del servidor HTTP configurado. La app también admite páginas de reproductor. Si hay varios, se prueban en orden.'),
    el('label', { class: 'actions' }, star, 'Destacar en la portada'),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar y publicar'), existing ? el('a', { class: 'ghost', href: '#/admin' }, 'Cancelar') : null),
    status,
  );
}

function ownList(rerender) {
  const data = file.data;
  if (!data.channels.length) return el('p', { class: 'note' }, 'Aún no has añadido canales propios.');
  return el(
    'div',
    { class: 'list' },
    data.channels.map((c) =>
      el(
        'div',
        { class: 'item' },
        c.logo ? el('img', { src: c.logo, alt: '' }) : el('span', { class: 'thumb' }),
        el('div', { class: 'meta' }, el('b', {}, `${data.featured.includes(c.id) ? '★ ' : ''}${c.name}`), el('span', {}, `${c.group || OWN_GROUP} · ${(c.streams || []).length} enlace(s)`)),
        el(
          'div',
          { class: 'actions' },
          el('a', { class: 'btn small secondary', href: `#/admin/editar/${encodeURIComponent(c.id)}` }, 'Editar'),
          el(
            'button',
            {
              class: 'btn small danger',
              type: 'button',
              onclick: async () => {
                if (saving || !confirm(`¿Eliminar ${c.name} y sus eventos asociados?`)) return;
                data.events = (data.events || []).filter((e) => e.channelId !== c.id);
                data.channels = data.channels.filter((x) => x.id !== c.id);
                data.featured = data.featured.filter((id) => id !== c.id);
                await guarded(() => saveFile(`admin: eliminar ${c.name}`), rerender);
              },
            },
            'Eliminar',
          ),
        ),
      ),
    ),
  );
}

async function guarded(action, rerender) {
  try {
    await action();
  } catch (err) {
    notice = explain(err);

  }
  rerender();
}

function tdtTools(state, rerender) {
  const data = file.data;
  const query = el('input', { type: 'search', placeholder: 'Buscar canal de TDT' });
  const out = el('div', { class: 'list' });
  const all = merge(state.tdt || { channels: [] }, null);
  const draw = () => {
    const q = query.value.trim().toLowerCase();
    const found = q ? all.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30) : all.filter((c) => data.hidden.includes(c.id) || data.featured.includes(c.id));
    out.replaceChildren(
      ...(found.length
        ? found.map((c) => {
            const hidden = data.hidden.includes(c.id);
            const star = data.featured.includes(c.id);
            return el(
              'div',
              { class: 'item' },
              c.logo ? el('img', { src: c.logo, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'thumb' }),
              el('div', { class: 'meta' }, el('b', {}, `${star ? '★ ' : ''}${c.name}`), el('span', {}, `${c.region || c.group}${hidden ? ' · oculto' : ''}${c.playable ? '' : ' · solo web oficial'}`)),
              el(
                'div',
                { class: 'actions' },
                el('button', { class: 'btn small secondary', type: 'button', disabled: !c.playable && !star, onclick: () => { if (saving) return; data.featured = star ? data.featured.filter((id) => id !== c.id) : [...data.featured, c.id]; guarded(() => saveFile(`admin: ${star ? 'quitar destacado' : 'destacar'} ${c.name}`), rerender); } }, star ? 'Quitar destacado' : 'Destacar'),
                el('button', { class: 'btn small secondary', type: 'button', onclick: () => { if (saving) return; data.hidden = hidden ? data.hidden.filter((id) => id !== c.id) : [...data.hidden, c.id]; guarded(() => saveFile(`admin: ${hidden ? 'mostrar' : 'ocultar'} ${c.name}`), rerender); } }, hidden ? 'Mostrar' : 'Ocultar'),
              ),
            );
          })
        : [el('p', { class: 'note', style: 'padding:12px' }, q ? 'Sin resultados.' : 'Busca un canal para destacarlo u ocultarlo.')]),
    );
  };
  query.addEventListener('input', draw);
  draw();
  return [el('div', { class: 'section-head' }, el('h2', {}, 'Canales TDT')), el('div', { class: 'form' }, field('Buscar', query)), out];
}

export async function render(state) {
  const view = document.getElementById('view');
  const rerender = async () => view.replaceChildren(...(await render(state)));
  await ready;
  if (!fallbackLoaded) {
    fallback = await fetchJson('data/custom.json');
    fallbackLoaded = true;
  }
  if (!watching) {
    watching = true;
    watchAuth(() => {
      file = null;
      if (location.hash.startsWith('#/admin')) rerender();
    });
  }
  if (!administrator()) return loginView(rerender);
  if (!file) {
    try { await loadFile(); }
    catch (error) { notice = explain(error); return loginView(rerender); }
  }
  if (!state.tdt) {
    try {
      state.tdt = await fetchJson('data/tdt.json');
    } catch {
      state.tdt = { channels: [] };
    }
  }
  // Keep the public view in this tab consistent with what was just saved.
  state.custom = file.data;
  state.channels = merge(state.tdt, file.data);
  file.data.events ||= [];
  const eventRoute = decodeURIComponent(location.hash).match(/^#\/admin\/(?:evento|editar-evento(?:\/(.+))?)$/);
  const editing = decodeURIComponent(location.hash).match(/^#\/admin\/editar\/(.+)$/);
  const existing = editing ? file.data.channels.find((c) => c.id === editing[1]) : null;
  const shown = notice;
  notice = '';
  return [
    el(
      'section',
      { class: 'panel' },
      el('div', { class: 'section-head' }, el('h1', {}, 'Administración'), el('button', { class: 'ghost', type: 'button', onclick: async () => { await logout(); file = null; rerender(); } }, 'Cerrar sesión')),
      el('p', { class: 'lead' }, 'Los cambios se guardan en Firebase y se comparten con la web y la app. Tu cuenta de Google es la única autorizada para editar.'),
      shown ? el('p', { class: shown.startsWith('Guardado') ? 'ok' : 'error', role: 'status' }, shown) : null,
      file.revision === 0 ? el('button', { class: 'btn', type: 'button', onclick: () => guarded(() => saveFile(), rerender) }, 'Activar catálogo compartido') : null,
      el('div', { class: 'actions admin-tabs' }, el('a', { class: eventRoute ? 'btn secondary' : 'btn', href: '#/admin' }, 'Crear canal'), el('a', { class: eventRoute ? 'btn' : 'btn secondary', href: '#/admin/evento' }, 'Crear evento')),
      eventRoute ? eventForm(eventRoute[1] ? file.data.events.find((e) => e.id === eventRoute[1]) : null, rerender) : channelForm(existing, rerender),
      el('div', { class: 'section-head' }, el('h2', {}, 'Eventos publicados')),
      eventList(rerender),
      el('div', { class: 'section-head' }, el('h2', {}, 'Canales creados')),
      ownList(rerender),
      ...tdtTools(state, rerender),
    ),
  ];
}

async function coverFromFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Elige una imagen.');
  if (file.size > 15 * 1024 * 1024) throw new Error('La imagen supera los 15 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.8, .65, .5, .35]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 130000) return data;
    }
    throw new Error('La imagen es demasiado compleja. Usa una más pequeña o un enlace HTTPS.');
  } finally { bitmap.close(); }
}

function eventForm(existing, rerender) {
  const data = file.data;
  const name = el('input', { required: true, value: existing?.name || '', placeholder: 'Local vs visitante' });
  const cover = el('input', { type: 'text', value: existing?.cover || '', placeholder: 'https://…/partido.jpg' });
  const preview = el('img', { class: 'event-preview', alt: 'Vista previa de la portada', hidden: !existing?.cover, src: existing?.cover });
  const updatePreview = () => { preview.hidden = !validCover(cover.value.trim()); if (!preview.hidden) preview.src = cover.value.trim(); };
  cover.addEventListener('input', updatePreview);
  const status = el('p', { class: 'note', role: 'status' });
  const upload = el('input', { type: 'file', accept: 'image/*', onchange: async () => {
    try { status.textContent = 'Preparando portada…'; cover.value = await coverFromFile(upload.files[0]); updatePreview(); status.textContent = 'Portada preparada.'; }
    catch (error) { status.textContent = error.message; }
  } });
  let selected = existing?.channelId || '';
  const chosen = el('p', { class: 'note' });
  const query = el('input', { type: 'search', placeholder: 'Buscar entre tus canales creados' });
  const options = el('div', { class: 'channel-options', role: 'group', 'aria-label': 'Elegir canal' });
  const draw = () => {
    const channel = data.channels.find((c) => c.id === selected);
    chosen.textContent = channel ? `Canal seleccionado: ${channel.name}` : 'Selecciona un canal para reproducir el evento.';
    const q = query.value.trim().toLocaleLowerCase('es');
    const found = data.channels.filter((c) => c.name.toLocaleLowerCase('es').includes(q));
    options.replaceChildren(...found.map((c) => el('button', { class: 'btn secondary', type: 'button', 'aria-pressed': String(c.id === selected), onclick: () => { selected = c.id; draw(); } }, `${c.id === selected ? '✓ ' : ''}${c.name}`)));
    if (!found.length) options.append(el('p', { class: 'note' }, data.channels.length ? 'Sin resultados.' : 'Crea primero un canal.'));
  };
  query.addEventListener('input', draw); draw();
  return el('form', { class: 'form', onsubmit: async (event) => {
    event.preventDefault(); if (saving) return;
    try {
      if (!name.value.trim()) throw new Error('Escribe el nombre del evento.');
      if (!validCover(cover.value.trim())) throw new Error('Añade una portada o un enlace de imagen HTTPS.');
      if (!data.channels.some((c) => c.id === selected)) throw new Error('Selecciona un canal creado.');
      const entry = { id: existing?.id || `evento-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: name.value.trim(), cover: cover.value.trim(), channelId: selected };
      data.events = existing ? data.events.map((e) => e.id === existing.id ? entry : e) : [...data.events, entry];
      status.textContent = 'Publicando…'; await saveFile(); rerender();
    } catch (error) { status.textContent = explain(error); status.className = 'error'; }
  } }, el('h2', {}, existing ? 'Editar evento' : 'Crear evento'), field('Nombre del evento', name), field('Foto de portada', upload, 'La imagen ocupa toda la carátula. Se comprime antes de guardarse.'), field('O pega el enlace HTTPS de la portada', cover), preview, field('Buscar canal', query), chosen, options,
  el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar y publicar'), existing ? el('a', { class: 'ghost', href: '#/admin/evento' }, 'Cancelar edición') : null), status);
}

function eventList(rerender) {
  const data = file.data;
  if (!data.events.length) return el('p', { class: 'note' }, 'Aún no hay eventos.');
  return el('div', { class: 'list' }, data.events.map((event) => el('div', { class: 'item' },
    el('img', { src: event.cover, alt: '', style: 'object-fit:cover' }),
    el('div', { class: 'meta' }, el('b', {}, event.name), el('span', {}, data.channels.find((c) => c.id === event.channelId)?.name || 'Canal no disponible')),
    el('div', { class: 'actions' }, el('a', { class: 'btn small secondary', href: `#/admin/editar-evento/${encodeURIComponent(event.id)}` }, 'Editar'),
      el('button', { class: 'btn small danger', type: 'button', onclick: () => {
        if (saving || !confirm(`¿Eliminar el evento ${event.name}?`)) return;
        data.events = data.events.filter((e) => e.id !== event.id); guarded(() => saveFile(), rerender);
      } }, 'Eliminar')))));
}
