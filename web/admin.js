import { resolveMatch, googleMatchUrl, listMatches, googleSearchFor, matchResult } from './match-scores.js';
import { eventOrder, eventMeta, eventPath, eventShareLink, localDateTime, madridInstant, EVENT_STATES } from './sports.js';
import { el, fetchJson } from './app.js';
import { OWN_GROUP, merge, categoryList, resolveCategory, defaultColor, eventSlugs } from './catalog.js';
import { validCover, validateCatalog } from './shared-catalog.js';
import { auth, ready, administrator, watchAuth, login, logout, readCatalog, publishCatalog, explain, audience, purgeAudience, visits, imageService, connectImageService, readLibrarySettings, saveLibrarySettings, publishLibraryParts } from './firebase.js';
import { firebaseConfig } from './firebase-config.js';
import { liveCounts, summarize, visitKey, madridDay } from './audience.js';
import { libraryAdmin } from './library.js';

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
  input.setAttribute('aria-label', label);
  return el('label', {}, label, input, hint ? el('small', {}, hint) : null);
}

function loginView(rerender) {
  const status = el('p', { class: 'note', role: 'status' }, notice);
  const button = el('button', { class: 'btn', type: 'button', onclick: async () => {
    button.disabled = true;
    status.textContent = 'Abriendo Google…';
    try {
      await login();
      if (!administrator()) throw new Error('Esta cuenta de Google no tiene permiso de administración.');
      await loadFile();
      notice = '';
      rerender();
    } catch (error) {
      status.textContent = explain(error);
      status.className = 'error';
    } finally { button.disabled = false; }
  } }, 'Continuar con Google');
  return [el('section', { class: 'panel' }, el('h1', {}, 'Administración'),
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

/** Saved categories in order, then any other category a channel uses (TDT or own), with its default colour. */
function allCategories(state) {
  const list = categoryList(file.data);
  const used = [...merge(state.tdt || { channels: [] }, null).map((c) => c.category), ...file.data.channels.map((c) => c.group || OWN_GROUP)];
  for (const g of used) if (!list.some((c) => c.id === g || c.name === g)) list.push({ id: g, name: g, color: defaultColor(g) });
  return list;
}

const NEW_GROUP = '\u0000nueva';
function channelForm(existing, rerender, state) {
  const data = file.data;
  const name = el('input', { required: true, value: existing ? existing.name : '' });
  // Pick an existing category or write a new one.
  const categories = allCategories(state);
  const current = resolveCategory(existing ? existing.group || OWN_GROUP : OWN_GROUP, categories).id;
  const groupSelect = el('select', {}, categories.map((c) => el('option', { value: c.id }, c.name)), el('option', { value: NEW_GROUP }, '+ Nueva categoría…'));
  groupSelect.value = categories.some((c) => c.id === current) ? current : NEW_GROUP;
  const groupNew = el('input', { placeholder: 'Nombre de la nueva categoría', maxlength: '80', value: categories.some((c) => c.id === current) ? '' : current });
  const groupNewField = field('Nueva categoría', groupNew);
  groupNewField.hidden = groupSelect.value !== NEW_GROUP;
  groupSelect.addEventListener('change', () => { groupNewField.hidden = groupSelect.value !== NEW_GROUP; if (!groupNewField.hidden) groupNew.focus(); });
  const group = { get value() { return groupSelect.value === NEW_GROUP ? groupNew.value : groupSelect.value; } };
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
            group: group.value.trim(),
            logo: logo.value.trim().startsWith('https://') ? logo.value.trim() : '',
            streams: validStreams(streams.value),
          };
          if (!channel.name) throw new Error('Escribe el nombre del canal.');
          if (!channel.group) throw new Error('Escribe el nombre de la nueva categoría.');
          if (groupSelect.value === NEW_GROUP) {
            // A name already in use joins that category; a new one is added at the end with its colour.
            const same = categories.find((c) => c.name.toLocaleLowerCase('es') === channel.group.toLocaleLowerCase('es'));
            if (same) channel.group = same.id;
            else data.categories = [...categories, { id: channel.group, name: channel.group, color: defaultColor(channel.group) }];
          }
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
    field('Categoría', groupSelect, 'Elige una de la lista o «Nueva categoría» para escribirla.'),
    groupNewField,
    field('Logo (opcional)', logo),
    field('Enlaces', streams, 'Uno por línea. La web reproduce .m3u8, .mp4 y .ts por HTTPS, los enlaces TS del servidor HTTP configurado y los vídeos MKV/AVI guardados en calamarmenciano.com (el hosting adapta su sonido). La app también admite páginas de reproductor. Si hay varios, se prueban en orden.'),
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
        el('div', { class: 'meta' }, el('b', {}, `${data.featured.includes(c.id) ? '★ ' : ''}${c.name}`), el('span', {}, `${resolveCategory(c.group || OWN_GROUP, categoryList(data)).name} · ${(c.streams || []).length} enlace(s)`)),
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

/**
 * Categories of the channels menu: order (drag the handle, or arrow keys on it), name and card colour,
 * plus new categories. Saved in the catalog as `categories`; an `id` never changes so channels keep it.
 */
function categoriesPanel(state, rerender) {
  const rows = allCategories(state).map((c) => ({ ...c }));
  const merged = merge(state.tdt || { channels: [] }, file.data);
  const count = (row) => merged.filter((c) => resolveCategory(c.category, rows).id === row.id).length
    + file.data.channels.filter((c) => !merged.some((m) => m.id === c.id) && resolveCategory(c.group || OWN_GROUP, rows).id === row.id).length;
  const list = el('ol', { class: 'order-list' });
  const status = el('p', { class: 'note', role: 'status' });
  const changed = () => { status.textContent = 'Cambios sin guardar.'; status.className = 'note'; };
  const move = (li, to) => {
    const items = [...list.children];
    to = Math.max(0, Math.min(items.length - 1, to));
    const from = items.indexOf(li);
    if (from === to) return;
    list.insertBefore(li, items[to + (to > from ? 1 : 0)] || null);
    numbers(); changed();
  };
  const numbers = () => [...list.children].forEach((li, i) => { li.querySelector('.order-n').textContent = i + 1; });
  const item = (row) => {
    const n = count(row);
    const handle = el('button', { class: 'drag-handle', type: 'button', 'aria-label': `Mover ${row.name}`, title: 'Arrastra para cambiar el orden (o usa las flechas)' }, '⠿');
    const color = el('input', { type: 'color', value: row.color, 'aria-label': `Color de ${row.name}` });
    const name = el('input', { value: row.name, maxlength: '80', 'aria-label': `Nombre de la categoría ${row.name}` });
    color.addEventListener('input', () => { row.color = color.value; li.style.setProperty('--c', row.color); changed(); });
    name.addEventListener('input', () => { row.name = name.value; handle.setAttribute('aria-label', `Mover ${name.value}`); changed(); });
    const remove = n ? null : el('button', { class: 'btn small danger', type: 'button', 'aria-label': `Eliminar ${row.name}`, onclick: () => { li.remove(); numbers(); changed(); } }, 'Eliminar');
    const li = el('li', { style: `--c:${row.color}` }, handle, el('b', { class: 'order-n' }), el('span', { class: 'swatch', 'aria-hidden': 'true' }), name, color,
      el('small', {}, n === 1 ? '1 canal' : `${n} canales`), remove);
    li._row = row;
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); move(li, [...list.children].indexOf(li) + (e.key === 'ArrowUp' ? -1 : 1)); handle.focus();
    });
    // Dragging works with mouse, finger or pen: the row follows the pointer and drops between the others.
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Listen on the window: moving the row in the page drops any pointer capture on it.
      e.preventDefault(); li.classList.add('dragging');
      const follow = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        const others = [...list.children].filter((x) => x !== li);
        const to = others.filter((x) => { const r = x.getBoundingClientRect(); return ev.clientY > r.top + r.height / 2; }).length;
        if (to !== [...list.children].indexOf(li)) { list.insertBefore(li, others[to] || null); numbers(); changed(); }
      };
      const drop = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        li.classList.remove('dragging');
        window.removeEventListener('pointermove', follow); window.removeEventListener('pointerup', drop); window.removeEventListener('pointercancel', drop);
      };
      window.addEventListener('pointermove', follow); window.addEventListener('pointerup', drop); window.addEventListener('pointercancel', drop);
    });
    return li;
  };
  list.append(...rows.map(item)); numbers();
  const newName = el('input', { maxlength: '80', placeholder: 'Por ejemplo «Cine»' });
  const newColor = el('input', { type: 'color', value: '#2d5a8a' });
  newName.addEventListener('input', () => { if (!newColor.dataset.picked) newColor.value = defaultColor(newName.value.trim()); });
  newColor.addEventListener('input', () => { newColor.dataset.picked = '1'; });
  const add = () => {
    const value = newName.value.trim();
    if (!value) { status.textContent = 'Escribe el nombre de la nueva categoría.'; status.className = 'error'; return; }
    const taken = [...list.children].some((li) => li._row.name.trim().toLocaleLowerCase('es') === value.toLocaleLowerCase('es') || li._row.id === value);
    if (taken) { status.textContent = `Ya existe la categoría «${value}».`; status.className = 'error'; return; }
    list.append(item({ id: value, name: value, color: newColor.value })); numbers(); changed();
    newName.value = ''; delete newColor.dataset.picked;
  };
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return [el('div', { class: 'section-head' }, el('h2', {}, 'Categorías')),
    el('p', { class: 'note' }, 'Arrastra ⠿ para ordenar el menú Canales de la web y de la app. Cambia el nombre o el color de fondo de las tarjetas de cada categoría.'),
    list,
    el('div', { class: 'category-add' }, field('Nombre de la nueva categoría', newName), field('Color de la nueva categoría', newColor), el('button', { class: 'btn secondary', type: 'button', onclick: add }, 'Añadir categoría')),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => {
        if (saving) return;
        const categories = [...list.children].map((li) => ({ id: li._row.id, name: li._row.name.trim(), color: li._row.color.toLowerCase() }));
        try { validateCatalog({ ...file.data, categories }); }
        catch (error) { status.textContent = error.message; status.className = 'error'; return; }
        file.data.categories = categories; delete file.data.groupOrder;
        guarded(() => saveFile(), rerender);
      } }, 'Guardar categorías'),
      file.data.categories || file.data.groupOrder ? el('button', { class: 'ghost', type: 'button', onclick: () => {
        if (saving || !confirm('¿Volver a los nombres, colores y orden por defecto? Las categorías creadas sin canales se perderán.')) return;
        delete file.data.categories; delete file.data.groupOrder; guarded(() => saveFile(), rerender);
      } }, 'Restablecer') : null),
    status];
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

function githubImagesPanel(rerender) {
  const message = el('p', { class: 'note', role: 'status' });
  const token = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Credencial de GitHub', 'aria-label': 'Credencial de GitHub' });
  const connect = el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
    connect.disabled = true;
    try { message.textContent = 'Conectando…'; const value = token.value.trim(); token.value = ''; await connectImageService(value); message.textContent = 'GitHub conectado. Las fotos nuevas se guardarán allí.'; }
    catch (e) { message.textContent = e.message; } finally { connect.disabled = false; }
  } }, 'Conectar GitHub');
  const check = el('button', { class: 'ghost', type: 'button', onclick: async () => {
    try { message.textContent = (await imageService()).configured ? 'GitHub conectado.' : 'Archivo instalado. Falta conectar la credencial de GitHub.'; }
    catch(e) { message.textContent = e.message; }
  } }, 'Comprobar conexión');
  return el('details', { class: 'image-settings' }, el('summary', {}, 'Imágenes en GitHub'),
    el('p', { class: 'note' }, 'Las imágenes se guardan en GitHub y el catálogo conserva solo sus enlaces. La primera vez, sube el archivo al hosting y conecta GitHub.'),
    el('a', { class: 'btn secondary', href: 'downloads/Calamar-Imagenes-GitHub.zip', download: '' }, 'Descargar archivo para el hosting'),
    el('p', { class: 'note' }, 'Crea una credencial de GitHub solo para Calamar-TV, con Contents: lectura y escritura. Se envía por HTTPS a tu hosting y se guarda fuera de la carpeta pública.'),
    el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer' }, 'Crear credencial en GitHub'),
    token, el('div', { class: 'actions' }, connect, check), message,
    el('button', { class: 'ghost', type: 'button', onclick: () => guarded(() => saveFile(), rerender) }, 'Guardar catálogo y liberar espacio de las portadas antiguas'));
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
  file.data.events ||= []; file.data.leagues ||= []; file.data.teams ||= [];
  const eventRoute = decodeURIComponent(location.hash).match(/^#\/admin\/(?:evento|editar-evento(?:\/(.+))?)$/);
  const editing = decodeURIComponent(location.hash).match(/^#\/admin\/editar\/(.+)$/);
  const existing = editing ? file.data.channels.find((c) => c.id === editing[1]) : null;
  const section = location.hash.startsWith('#/admin/biblioteca') ? 'library' : location.hash.startsWith('#/admin/estadisticas') ? 'stats' : location.hash.startsWith('#/admin/ligas') ? 'leagues' : location.hash.startsWith('#/admin/equipos') ? 'teams' : eventRoute ? 'events' : 'channels';
  const shown = notice;
  notice = '';
  return [
    el(
      'section',
      { class: 'panel' },
      el('div', { class: 'section-head' }, el('h1', {}, 'Administración'), el('button', { class: 'ghost', type: 'button', onclick: async () => { await logout(); file = null; rerender(); } }, 'Cerrar sesión')),
      el('p', { class: 'lead' }, 'Los cambios se guardan en Firebase y se comparten con la web y la app. Tu cuenta de Google es la única autorizada para editar.'),
      shown ? el('p', { class: shown.startsWith('Guardado') ? 'ok' : 'error', role: 'status' }, shown) : null,
      githubImagesPanel(rerender),
      file.revision === 0 ? el('button', { class: 'btn', type: 'button', onclick: () => guarded(() => saveFile(), rerender) }, 'Activar catálogo compartido') : null,
      el('div', { class: 'admin-stats' }, [['channels','Canales','#/admin'], ['events','Eventos','#/admin/evento'], ['leagues','Ligas','#/admin/ligas'], ['teams','Equipos','#/admin/equipos'], ['stats','Estadísticas','#/admin/estadisticas'], ['library','Pelis y series','#/admin/biblioteca']].map(([key,label,href]) => el('a', { href, 'aria-current': section === key ? 'page' : null }, key === 'stats' ? liveTile() : key === 'library' ? el('b', {}, file.data.libraryVisible ? 'On' : 'Off') : el('b', {}, file.data[key].length), label))),
      ...(section === 'library' ? libraryAdmin(el, {
        visible: file.data.libraryVisible === true,
        // The switch is part of the catalog, so the web and the app pick it up like any other change.
        setVisible: async (on) => { if (saving) throw new Error('Espera a que termine la publicación.'); file.data.libraryVisible = on; await saveFile(); state.custom = file.data; },
        field, readSettings: readLibrarySettings, saveSettings: saveLibrarySettings, publish: publishLibraryParts, driveKey: firebaseConfig.apiKey,
      }) : section === 'stats' ? statsPanel(state) : section === 'leagues' || section === 'teams' ? entityPanel(section, rerender) : section === 'events' ? [
        eventForm(eventRoute[1] ? file.data.events.find((e) => e.id === eventRoute[1]) : null, rerender),
        el('div', { class: 'section-head' }, el('h2', {}, 'Eventos publicados')), eventList(rerender)
      ] : [channelForm(existing, rerender, state), el('div', { class: 'section-head' }, el('h2', {}, 'Canales creados')), ownList(rerender), ...categoriesPanel(state, rerender), ...tdtTools(state, rerender)]),
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
  const league = selectField(data.leagues, existing?.leagueId, 'Sin liga');
  const home = selectField(data.teams, existing?.homeTeamId, 'Seleccionar local');
  const away = selectField(data.teams, existing?.awayTeamId, 'Seleccionar visitante');
  let lastAuto = '';
  const fillName = () => {
    const local = data.teams.find(t => t.id === home.value), visitor = data.teams.find(t => t.id === away.value);
    if (local && visitor && (!name.value.trim() || name.value === lastAuto)) name.value = lastAuto = `${local.name} vs ${visitor.name}`;
  };
  home.addEventListener('change', fillName); away.addEventListener('change', fillName);
  const matchLink = el('input', { type: 'url', value: existing?.matchUrl || '', placeholder: 'https://share.google/… o https://www.google.com/search?…' });
  const matchPreview = el('p', { class: 'note', role: 'status' });
  let checkedMatch = null, checking = false;
  const checkMatch = async () => {
    if (checking) throw Error('Espera a que termine la comprobación del partido.');
    checking = true; matchPreview.textContent = 'Identificando partido…';
    try {
      const resolved = await resolveMatch(matchLink.value.trim(), madridInstant(start.value));
      checkedMatch = { ...resolved, start: start.value };
      const when = new Date(resolved.matchDate).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      matchPreview.textContent = `Partido: ${resolved.result.home} – ${resolved.result.away} · ${when} · ${resolved.result.text} · Resultados: ESPN${resolved.bothTeams ? '' : ' · Solo se reconoció un equipo: comprueba que sea el partido correcto.'}`;
      return resolved;
    } finally { checking = false; }
  };
  const matchCheck = el('button', { type: 'button', class: 'btn secondary', onclick: async () => { try { await checkMatch(); } catch (e) { matchPreview.textContent = `${e.message} Si no lo reconoce, pulsa «Elegir el partido de la lista».`; } } }, 'Comprobar partido');
  // When a link is not recognised (or there is none), the match can be chosen from ESPN's list for that date.
  const pickList = el('div', { class: 'match-picker', hidden: true });
  const norm = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const choose = (m) => {
    const url = matchLink.value.trim() || googleSearchFor(m.home, m.away);
    matchLink.value = url;
    checkedMatch = { matchUrl: url, matchId: m.id, matchDate: m.date, start: start.value, result: matchResult(m.event), bothTeams: true };
    const when = new Date(m.date).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    matchPreview.textContent = `Partido elegido: ${m.home} – ${m.away} · ${when}. Pulsa «Guardar y publicar».`;
    pickList.hidden = true;
  };
  const openPicker = async () => {
    pickList.hidden = false;
    pickList.replaceChildren(el('p', { class: 'note' }, 'Cargando los partidos de ESPN de esa fecha…'));
    let all;
    try { all = await listMatches(madridInstant(start.value)); }
    catch (e) { pickList.replaceChildren(el('p', { class: 'error' }, e.message)); return; }
    const search = el('input', { type: 'search', placeholder: 'Buscar equipo, por ejemplo «Celtic»' });
    const rows = el('div', { class: 'match-options' });
    const draw = () => {
      const words = norm(search.value).split(/\s+/).filter(Boolean);
      const found = all.filter((m) => words.every((w) => norm(`${m.home} ${m.away} ${m.league}`).includes(w))).slice(0, 40);
      rows.replaceChildren(...found.map((m) => el('button', { type: 'button', class: 'btn secondary match-option', onclick: () => choose(m) },
        `${new Date(m.date).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${m.home} – ${m.away}${m.league ? ` · ${m.league}` : ''}`)));
      if (!found.length) rows.append(el('p', { class: 'note' }, all.length ? 'Ningún partido con ese nombre en ESPN para esa fecha.' : 'ESPN no tiene partidos para esa fecha.'));
    };
    search.addEventListener('input', draw);
    pickList.replaceChildren(field('Buscar en ESPN (del día anterior al siguiente)', search), rows);
    draw(); search.focus();
  };
  const matchPick = el('button', { type: 'button', class: 'btn secondary', onclick: openPicker }, 'Elegir el partido de la lista');
  const start = el('input', { type: 'datetime-local', required: true, value: localDateTime(existing?.startAt), step: '60' });
  const star = el('input', { type: 'checkbox', checked: !!existing?.featured });
  const state = selectField(Object.entries(EVENT_STATES).map(([id,name]) => ({id,name})), existing?.status || 'scheduled');
  const season = el('input', { value: existing?.season || '', placeholder: '2026/2027' });
  const round = el('input', { value: existing?.round || '', placeholder: 'Jornada 1 / Final' });
  const venue = el('input', { value: existing?.venue || '' });
  const description = el('textarea', {}, existing?.description || '');
  let selectedCover = existing?.cover || '';
  const cover = el('input', { type: 'url', value: selectedCover.startsWith('https://') ? selectedCover : '', placeholder: 'https://…/partido.jpg' });
  const preview = el('img', { class: 'event-preview', alt: 'Vista previa de la portada', hidden: !existing?.cover, src: existing?.cover });
  const updatePreview = () => { preview.hidden = !validCover(selectedCover); if (!preview.hidden) preview.src = selectedCover; };
  cover.addEventListener('input', () => { selectedCover = cover.value.trim(); updatePreview(); });
  const status = el('p', { class: 'note', role: 'status' });
  const upload = el('input', { type: 'file', accept: 'image/*', onchange: async () => {
    try { status.textContent = 'Preparando portada…'; selectedCover = await coverFromFile(upload.files[0]); cover.value = ''; updatePreview(); status.textContent = 'Portada preparada.'; }
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
      if (!validCover(selectedCover)) throw new Error('Añade una portada o un enlace de imagen HTTPS.');
      if (!data.channels.some((c) => c.id === selected)) throw new Error('Selecciona un canal creado.');
      const entry = { ...(existing || {}), id: existing?.id || `evento-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: name.value.trim(), cover: selectedCover, channelId: selected, startAt: madridInstant(start.value), featured: star.checked, leagueId: league.value, homeTeamId: home.value, awayTeamId: away.value, status: state.value, season: season.value.trim(), round: round.value.trim(), venue: venue.value.trim(), description: description.value.trim() };
      const link = matchLink.value.trim();
      if (link) {
        googleMatchUrl(link);
        const resolved = checkedMatch?.matchUrl === link && checkedMatch.start === start.value ? checkedMatch
          : existing?.matchUrl === link && existing.startAt === entry.startAt && existing.matchId ? existing : await checkMatch();
        Object.assign(entry, { matchUrl: link, matchId: resolved.matchId, matchDate: resolved.matchDate });
      } else { delete entry.matchUrl; delete entry.matchId; delete entry.matchDate; }
      const updated = existing ? data.events.map((e) => e.id === existing.id ? entry : e) : [...data.events, entry];
      validateCatalog({ ...data, events: updated }, { checkSize: false });
      data.events = updated;
      status.textContent = 'Publicando…'; await saveFile(); rerender();
    } catch (error) { status.textContent = explain(error); status.className = 'error'; }
  } }, el('h2', {}, existing ? 'Editar evento' : 'Crear evento'), field('Nombre del evento', name), el('div', { class: 'event-fields' }, field('Liga', league), field('Fecha y hora', start, 'Horario de Madrid (España), con cambio de hora automático.'), field('Equipo local', home), field('Equipo visitante', away), field('Temporada', season), field('Jornada o fase', round), field('Estado', state), field('Lugar', venue)), field('Descripción', description), field('Enlace del partido en Google (opcional)', matchLink, 'Pega el enlace de Compartir de Google del partido. Se reconoce por el propio enlace, aunque el nombre, los equipos o la fecha del evento no coincidan. Marcador, estadísticas y alineaciones: ESPN; solo partidos de su cobertura.'), el('div', { class: 'actions' }, matchCheck, matchPick), matchPreview, pickList, el('label', { class: 'actions' }, star, 'Destacar en portada'), field('Foto de portada', upload, 'La imagen ocupa toda la carátula. Se comprime y se guarda en GitHub al publicar.'), field('O pega el enlace HTTPS de la portada', cover), preview, field('Buscar canal', query), chosen, options,
  el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar y publicar'), existing ? el('a', { class: 'ghost', href: '#/admin/evento' }, 'Cancelar edición') : null), status);
}


function eventList(rerender) {
  const data = file.data;
  const query = el('input', { type: 'search', placeholder: 'Buscar evento o equipo' });
  const league = selectField(data.leagues, '', 'Todas las ligas');
  const output = el('div', { class: 'list' });
  const slugs = eventSlugs(data);
  const draw = () => {
    const found = [...data.events].sort(eventOrder).filter(e => (!league.value || e.leagueId === league.value) && `${e.name} ${eventMeta(e, data)}`.toLocaleLowerCase('es').includes(query.value.trim().toLocaleLowerCase('es')));
    output.replaceChildren(...found.map(event => el('div', { class: 'item' },
      el('img', { src: event.cover, alt: '', style: 'object-fit:cover' }),
      el('div', { class: 'meta' }, el('b', {}, `${event.featured ? '★ ' : ''}${event.name}`), el('span', {}, eventMeta(event, data)), el('span', {}, data.channels.find(c => c.id === event.channelId)?.name || 'Canal no disponible')),
      el('div', { class: 'actions' }, el('a', { class: 'btn small secondary', href: eventPath({ ...event, slug: slugs.get(event.id) }) }, 'Abrir evento'),
        el('button', { class: 'btn small secondary', type: 'button', onclick: async (e) => {
          try { const button = e.currentTarget; await navigator.clipboard.writeText(eventShareLink({ ...event, slug: slugs.get(event.id) })); button.textContent = 'Copiado'; }
          catch { notice = 'No se pudo copiar. Usa Abrir evento y copia la dirección.'; rerender(); }
        } }, 'Copiar enlace'),
        el('a', { class: 'btn small secondary', href: `#/admin/editar-evento/${encodeURIComponent(event.id)}` }, 'Editar'),
        el('button', { class: 'btn small danger', type: 'button', onclick: () => {
          if (saving || !confirm(`¿Eliminar el evento ${event.name}?`)) return;
          data.events = data.events.filter(e => e.id !== event.id); guarded(() => saveFile(), rerender);
        } }, 'Eliminar')))));
    if (!found.length) output.append(el('p', { class: 'note' }, 'No hay eventos para esta búsqueda.'));
  };
  query.addEventListener('input', draw); league.addEventListener('change', draw); draw();
  return el('div', {}, el('div', { class: 'event-fields form' }, field('Buscar eventos', query), field('Filtrar por liga', league)), output);
}

function selectField(items, selected = '', empty = null) {
  const select = el('select', {}, empty !== null ? el('option', { value: '' }, empty) : null, items.map(item => el('option', { value: item.id }, item.name)));
  select.value = selected || ''; return select;
}

function entityPanel(kind, rerender) {
  const data = file.data, team = kind === 'teams', title = team ? 'equipo' : 'liga';
  const key = decodeURIComponent(location.hash.split('/')[3] || '');
  const existing = data[kind].find(item => item.id === key);
  const name = el('input', { required: true, value: existing?.name || '' });
  let selectedLogo = existing?.logo || '';
  const logo = el('input', { type: 'url', value: selectedLogo.startsWith('https://') ? selectedLogo : '', placeholder: 'https://…/escudo.png' });
  logo.addEventListener('input', () => { selectedLogo = logo.value.trim(); });
  const preview = el('img', { class: 'event-preview', alt: 'Logo', src: selectedLogo || undefined, hidden: !selectedLogo, style: 'object-fit:contain;max-height:120px' });
  const status = el('p', { class: 'note', role: 'status' });
  const upload = el('input', { type: 'file', accept: 'image/*', onchange: async () => {
    try { selectedLogo = await coverFromFile(upload.files[0]); logo.value = ''; preview.src = selectedLogo; preview.hidden = false; status.textContent = 'Imagen preparada.'; }
    catch (error) { status.textContent = error.message; }
  } });
  const league = selectField(data.leagues, existing?.leagueId, 'Sin liga principal');
  const form = el('form', { class: 'form', onsubmit: async e => {
    e.preventDefault(); if (saving) return;
    try {
      if (!name.value.trim()) throw new Error('Escribe el nombre.');
      if (selectedLogo && !validCover(selectedLogo)) throw new Error('Usa una imagen o un enlace HTTPS.');
      const entry = { ...(existing || {}), id: existing?.id || `${team ? 'equipo' : 'liga'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`, name: name.value.trim(), logo: selectedLogo, ...(team ? { leagueId: league.value } : {}) };
      const updated = existing ? data[kind].map(item => item.id === existing.id ? entry : item) : [...data[kind], entry];
      validateCatalog({ ...data, [kind]: updated }, { checkSize: false }); data[kind] = updated;
      await saveFile(); location.hash = `#/admin/${team ? 'equipos' : 'ligas'}`; rerender();
    } catch (error) { status.textContent = explain(error); }
  } }, el('h2', {}, `${existing ? 'Editar' : 'Crear'} ${title}`), field(`Nombre de ${title}`, name), field(team ? 'Escudo (opcional)' : 'Logo (opcional)', upload), field('O enlace HTTPS de la imagen', logo), preview, team ? field('Liga principal', league, 'Un equipo puede participar en eventos de otras ligas.') : null,
  el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, 'Guardar y publicar'), existing ? el('a', { class: 'ghost', href: `#/admin/${team ? 'equipos' : 'ligas'}` }, 'Cancelar edición') : null), status);
  const query = el('input', { type: 'search', placeholder: team ? 'Buscar equipo' : 'Buscar liga' }), output = el('div', { class: 'list' });
  const draw = () => output.replaceChildren(...data[kind].filter(item => item.name.toLocaleLowerCase('es').includes(query.value.trim().toLocaleLowerCase('es'))).sort((a,b) => a.name.localeCompare(b.name,'es')).map(item => el('div', { class: 'item' },
    item.logo ? el('img', { src: item.logo, alt: '' }) : null, el('div', { class: 'meta' }, el('b', {}, item.name), team ? el('span', {}, data.leagues.find(l => l.id === item.leagueId)?.name || '') : null),
    el('div', { class: 'actions' }, el('a', { class: 'btn small secondary', href: `#/admin/${team ? 'equipos' : 'ligas'}/${encodeURIComponent(item.id)}` }, 'Editar'),
    el('button', { class: 'btn small danger', type: 'button', onclick: () => {
      if (saving) return;
      const used = data.events.some(e => team ? e.homeTeamId === item.id || e.awayTeamId === item.id : e.leagueId === item.id) || (!team && data.teams.some(t => t.leagueId === item.id));
      if (used) { notice = 'No se puede eliminar: está en uso. Cambia primero sus equipos o eventos asociados.'; rerender(); return; }
      if (!confirm(`¿Eliminar ${item.name}?`)) return;
      data[kind] = data[kind].filter(x => x.id !== item.id); guarded(() => saveFile(), rerender);
    } }, 'Eliminar')))));
  query.addEventListener('input', draw); draw();
  return [form, el('h2', {}, team ? 'Equipos creados' : 'Ligas creadas'), field('Buscar', query), output];
}

// ---- Statistics ---------------------------------------------------------------------------------
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const statsView = { mode: 'day', day: '', month: '', year: '', only: null };

/** Names for every channel and event, including TDT channels that are hidden from the public. */
function statsNames(state) {
  const names = new Map();
  for (const c of [...merge(state.tdt || { channels: [] }, null), ...file.data.channels]) {
    names.set(visitKey('channel', c.id), c.name); names.set(`c:${c.id}`, c.name);
  }
  for (const e of file.data.events) {
    const label = `${e.name}${e.startAt ? ` · ${eventMeta({ startAt: e.startAt }, null)}` : ''}`;
    names.set(visitKey('event', e.id), label); names.set(`e:${e.id}`, label);
  }
  return names;
}

const plural = (n, one, many) => `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;
const shiftDay = (day, delta) => new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);

/** People watching right now, shown on the statistics tab. */
function liveTile() {
  const value = el('b', { title: 'Personas viendo ahora' }, '…');
  audience().then((docs) => { value.textContent = [...liveCounts(docs).values()].reduce((a, b) => a + b, 0).toLocaleString('es-ES'); }).catch(() => { value.textContent = '–'; });
  return value;
}

function statsPanel(state) {
  const names = statsNames(state);
  const today = madridDay();
  statsView.day ||= today; statsView.month ||= today.slice(0, 7); statsView.year ||= today.slice(0, 4);

  // Live: refreshed every 20 seconds while this page is open.
  const liveBody = el('div', { class: 'stats-live' }, el('p', { class: 'note' }, 'Cargando espectadores…'));
  const liveTotal = el('b', {}, '–');
  const updated = el('span', { class: 'note' });
  const drawLive = async () => {
    try {
      const counts = liveCounts(await audience());
      const lists = { c: [], e: [] };
      for (const [target, viewers] of counts) lists[target[0]]?.push({ name: names.get(target) || target.slice(2), viewers });
      liveTotal.textContent = [...counts.values()].reduce((a, b) => a + b, 0).toLocaleString('es-ES');
      updated.textContent = `Actualizado a las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      const column = (title, list, empty) => el('div', { class: 'stats-card' }, el('h3', {}, title),
        list.length ? el('ol', { class: 'stats-rank' }, list.sort((a, b) => b.viewers - a.viewers || a.name.localeCompare(b.name, 'es'))
          .map((item) => el('li', {}, el('span', {}, item.name), el('b', {}, plural(item.viewers, 'persona', 'personas'))))) : el('p', { class: 'note' }, empty));
      liveBody.replaceChildren(column('Canales', lists.c, 'Nadie está viendo canales ahora.'), column('Eventos', lists.e, 'Nadie está viendo eventos ahora.'));
    } catch (error) { liveBody.replaceChildren(el('p', { class: 'error' }, `No se pudieron leer los espectadores: ${explain(error)}`)); }
  };
  // Stops by itself once the panel leaves the page; a redrawn panel starts its own timer.
  const tick = () => { if (!liveBody.isConnected) return; drawLive(); setTimeout(tick, 20000); };
  drawLive(); setTimeout(tick, 20000);
  purgeAudience().catch(() => {});

  // History: one document per Madrid day with one counter per channel and event.
  const history = el('div', { class: 'stats-history' }, el('p', { class: 'note' }, 'Cargando visitas…'));
  const modes = [['day', 'Día'], ['month', 'Mes'], ['year', 'Año'], ['all', 'Por años']];
  const modeButtons = el('div', { class: 'chips', role: 'group', 'aria-label': 'Periodo' }, modes.map(([mode, label]) =>
    el('button', { class: 'chip', type: 'button', 'aria-pressed': String(statsView.mode === mode), onclick: () => { statsView.mode = mode; statsView.only = null; redraw(); } }, label)));
  const picker = el('div', { class: 'stats-picker' });
  const redraw = () => {
    for (const [i, button] of [...modeButtons.children].entries()) button.setAttribute('aria-pressed', String(modes[i][0] === statsView.mode));
    const input = statsView.mode === 'day' ? el('input', { type: 'date', value: statsView.day, max: today })
      : statsView.mode === 'month' ? el('input', { type: 'month', value: statsView.month, max: today.slice(0, 7) })
      : statsView.mode === 'year' ? el('select', {}, Array.from({ length: Number(today.slice(0, 4)) - 2025 }, (_, i) => String(2026 + i)).reverse().map((y) => el('option', { value: y }, y))) : null;
    if (input) {
      if (statsView.mode === 'year') input.value = statsView.year;
      input.addEventListener('change', () => { if (input.value) { statsView[statsView.mode] = input.value; statsView.only = null; load(); } });
      picker.replaceChildren(field(statsView.mode === 'day' ? 'Día' : statsView.mode === 'month' ? 'Mes' : 'Año', input));
    } else picker.replaceChildren();
    load();
  };
  let request = 0;
  const load = async () => {
    const mine = ++request;
    const { mode } = statsView;
    const [from, to] = mode === 'day' ? [shiftDay(statsView.day, -29), statsView.day]
      : mode === 'month' ? [`${statsView.month}-01`, `${statsView.month}-31`]
      : mode === 'year' ? [`${statsView.year}-01-01`, `${statsView.year}-12-31`] : ['2000-01-01', '2999-12-31'];
    history.replaceChildren(el('p', { class: 'note' }, 'Cargando visitas…'));
    try {
      const days = await visits(from, to);
      if (mine === request) history.replaceChildren(...visitReport(days, names, from, to));
    } catch (error) { if (mine === request) history.replaceChildren(el('p', { class: 'error' }, `No se pudieron leer las visitas: ${explain(error)}`)); }
  };
  redraw();
  return [
    el('div', { class: 'section-head' }, el('h2', {}, 'En vivo ahora'), updated),
    el('p', { class: 'stats-total' }, liveTotal, ' personas viendo en este momento'),
    liveBody,
    el('div', { class: 'section-head' }, el('h2', {}, 'Visitas')),
    el('p', { class: 'note' }, 'Cada vez que alguien abre un canal o un evento cuenta como una visita; la visita a un evento también suma a su canal (días según el horario de Madrid).'),
    el('div', { class: 'stats-controls' }, modeButtons, picker),
    history,
  ];
}

function visitReport(days, names, from, to) {
  const { mode, only } = statsView;
  // Tables: the selected day, month, year or everything.
  const tableDays = mode === 'day' ? days.filter((d) => d.id === statsView.day) : days;
  const { totals } = summarize(tableDays);
  const sum = (prefix) => [...totals].filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v, 0);
  const period = mode === 'day' ? new Date(`${statsView.day}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : mode === 'month' ? `${MONTHS[Number(statsView.month.slice(5)) - 1]} ${statsView.month.slice(0, 4)}` : mode === 'year' ? statsView.year : 'desde el principio';
  const table = (title, prefix) => {
    const rows = [...totals].filter(([k]) => k.startsWith(prefix)).sort((a, b) => b[1] - a[1]);
    const top = rows[0]?.[1] || 1;
    return el('div', { class: 'stats-card' }, el('h3', {}, `${title} · ${plural(sum(prefix), 'visita', 'visitas')}`),
      rows.length ? el('table', { class: 'stats-table' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, prefix === 'c_' ? 'Canal' : 'Evento'), el('th', { scope: 'col' }, 'Visitas'))),
        el('tbody', {}, rows.map(([key, value]) => el('tr', { 'aria-selected': String(key === only) },
          el('td', {}, el('button', { type: 'button', class: 'linkish', title: 'Ver su evolución en la gráfica', onclick: () => { statsView.only = key === only ? null : key; document.getElementById('view').querySelector('.stats-history').replaceChildren(...visitReport(days, names, from, to)); } },
            el('span', { class: 'share', style: `--w:${Math.max(2, Math.round(value / top * 100))}%`, 'aria-hidden': 'true' }), names.get(key) || `${key.slice(2)} (eliminado)`)),
          el('td', {}, value.toLocaleString('es-ES'))))))
        : el('p', { class: 'note' }, `Sin visitas a ${title.toLowerCase()} en este periodo.`));
  };
  // Chart: day by day (30 days or one month), month by month, or year by year.
  // Every opening adds to a channel (events also add to theirs), so the channel counters are the total.
  const { buckets } = summarize(days, mode === 'year' ? 'month' : mode === 'all' ? 'year' : 'day', only || 'c_');
  let keys;
  if (mode === 'year') keys = Array.from({ length: 12 }, (_, i) => `${statsView.year}-${String(i + 1).padStart(2, '0')}`);
  else if (mode === 'all') { const years = days.map((d) => Number(d.id.slice(0, 4))); keys = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => String(Math.min(...years) + i)) : []; }
  else { keys = []; for (let d = from; d <= to && keys.length < 31; d = shiftDay(d, 1)) if (d.slice(0, 7) === from.slice(0, 7) || mode === 'day') keys.push(d); }
  const label = (key) => key.length === 4 ? key : key.length === 7 ? MONTHS[Number(key.slice(5)) - 1] : String(Number(key.slice(8)));
  const full = (key) => key.length === 4 ? key : key.length === 7 ? `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}` : new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const max = Math.max(1, ...keys.map((k) => buckets.get(k) || 0));
  const chart = keys.length ? el('div', { class: 'stats-chart', role: 'img', 'aria-label': `Visitas por ${mode === 'year' ? 'mes' : mode === 'all' ? 'año' : 'día'}` },
    keys.map((key) => { const value = buckets.get(key) || 0; return el('div', { class: 'bar', 'data-current': String(mode === 'day' && key === statsView.day), title: `${full(key)}: ${plural(value, 'visita', 'visitas')}` },
      el('span', { class: 'value' }, value ? value.toLocaleString('es-ES') : ''), el('span', { class: 'fill', style: `--h:${value / max * 100}%` }), el('span', { class: 'tick' }, label(key))); }))
    : el('p', { class: 'note' }, 'Todavía no hay visitas registradas.');
  return [
    el('p', { class: 'stats-total' }, el('b', {}, plural(sum('c_'), 'visita', 'visitas')), ` · ${period}`),
    el('div', { class: 'stats-card stats-chart-card' },
      el('h3', {}, `${only ? `Evolución de ${names.get(only) || only.slice(2)}` : 'Evolución de todas las visitas'} · ${mode === 'day' ? 'últimos 30 días' : mode === 'month' ? 'día a día' : mode === 'year' ? 'mes a mes' : 'año a año'}`),
      only ? el('button', { type: 'button', class: 'ghost', onclick: () => { statsView.only = null; document.getElementById('view').querySelector('.stats-history').replaceChildren(...visitReport(days, names, from, to)); } }, 'Ver todas') : null,
      chart),
    el('div', { class: 'stats-live' }, table('Canales', 'c_'), table('Eventos', 'e_')),
  ];
}
