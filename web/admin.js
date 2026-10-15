// Administration: edits data/custom.json in the GitHub repository through the GitHub API.
// The real credential is a fine-grained GitHub token limited to this repository. It is kept only
// in this browser, encrypted with a key derived from the administrator's password (PBKDF2 +
// AES-GCM). No password or token is stored in the repository or in the app.
import { el, fetchJson } from './app.js';
import { GROUP_ORDER, OWN_GROUP, merge } from './catalog.js';

const ADMIN_EMAIL = 'juanjocarrillo7@gmail.com';
const REPO = 'djyuanyo/Calamar-TV';
const PATH = 'data/custom.json';
const VAULT = 'calamar-admin-vault';
const API = `https://api.github.com/repos/${REPO}`;

let token = null;
let file = null; // { sha, data }
let notice = '';

// ---- Vault -----------------------------------------------------------------------------------

const bytes = (s) => new TextEncoder().encode(s);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function key(password, salt) {
  const base = await crypto.subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function readVault() {
  try {
    return JSON.parse(localStorage.getItem(VAULT) || 'null');
  } catch {
    return null;
  }
}

async function lock(email, password, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), bytes(secret));
  localStorage.setItem(VAULT, JSON.stringify({ email, salt: b64(salt), iv: b64(iv), data: b64(data) }));
}

async function unlock(email, password) {
  const vault = readVault();
  if (!vault || vault.email !== email) throw new Error('Correo o contraseña incorrectos');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, await key(password, unb64(vault.salt)), unb64(vault.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('Correo o contraseña incorrectos');
  }
}

// ---- GitHub ----------------------------------------------------------------------------------

async function github(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!response.ok) {
    const error = new Error(response.status === 409 || response.status === 422 ? 'El catálogo cambió mientras editabas. Recarga y vuelve a guardar.' : response.status === 401 || response.status === 403 ? 'El token de GitHub no es válido o no tiene permiso de escritura en el repositorio.' : `GitHub respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function verifyToken(candidate) {
  token = candidate;
  const repo = await github('');
  if (!repo.permissions || !repo.permissions.push) throw new Error('El token no tiene permiso de escritura en el repositorio.');
}

async function loadFile() {
  const d = await github(`/contents/${PATH}?ref=main`);
  const text = new TextDecoder().decode(unb64(d.content.replace(/\s/g, '')));
  file = { sha: d.sha, data: JSON.parse(text) };
  for (const k of ['featured', 'hidden', 'channels']) if (!Array.isArray(file.data[k])) file.data[k] = [];
}

async function saveFile(message) {
  const text = JSON.stringify(file.data, null, 1) + '\n';
  let binary = '';
  for (const b of bytes(text)) binary += String.fromCharCode(b);
  const result = await github(`/contents/${PATH}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: btoa(binary), sha: file.sha, branch: 'main' }),
  });
  file.sha = result.content.sha;
  notice = 'Guardado. La web y la app lo mostrarán en 1–2 minutos, cuando GitHub publique la nueva versión.';
}

// ---- Views -----------------------------------------------------------------------------------

function field(label, input, hint) {
  return el('label', {}, label, input, hint ? el('small', {}, hint) : null);
}

function loginView(rerender) {
  const vault = readVault();
  const email = el('input', { type: 'email', required: true, autocomplete: 'username', value: vault ? vault.email : '' });
  const password = el('input', { type: 'password', required: true, autocomplete: vault ? 'current-password' : 'new-password', minlength: 8 });
  const repeat = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const secret = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
  const status = el('p', { class: 'note', 'aria-live': 'polite' });
  const form = el(
    'form',
    {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        status.textContent = 'Comprobando…';
        try {
          const mail = email.value.trim().toLowerCase();
          if (mail !== ADMIN_EMAIL) throw new Error('Esta cuenta no es administradora');
          if (vault) {
            await verifyToken(await unlock(mail, password.value));
          } else {
            if (password.value !== repeat.value) throw new Error('Las contraseñas no coinciden');
            await verifyToken(secret.value.trim());
            await lock(mail, password.value, token);
          }
          await loadFile();
          rerender();
        } catch (err) {
          token = null;
          status.textContent = err.message;
          status.className = 'error';
        }
      },
    },
    field('Correo', email),
    field('Contraseña', password, vault ? null : 'Mínimo 8 caracteres. No se envía a ningún sitio: cifra el token en este navegador.'),
    vault ? null : field('Repite la contraseña', repeat),
    vault ? null : field('Token de GitHub', secret, `Token «fine-grained» con acceso solo a ${REPO} y permiso Contents: Read and write. Se guarda cifrado en este navegador.`),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'submit' }, vault ? 'Entrar' : 'Configurar este dispositivo'), vault ? el('button', { class: 'ghost', type: 'button', onclick: () => { if (confirm('¿Olvidar el acceso guardado en este navegador?')) { localStorage.removeItem(VAULT); rerender(); } } }, 'Olvidar este dispositivo') : null),
    status,
  );
  return [
    el('section', { class: 'panel' }, el('h1', {}, 'Administración'), el('p', { class: 'lead' }, vault ? 'Entra con tu correo y contraseña.' : 'Primera vez en este navegador: crea tu contraseña y pega el token de GitHub.'), form),
  ];
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
        try {
          const channel = {
            id: existing ? existing.id : `mio-${slug(name.value)}-${Date.now().toString(36)}`,
            name: name.value.trim(),
            group: group.value.trim() || OWN_GROUP,
            logo: logo.value.trim().startsWith('https://') ? logo.value.trim() : '',
            streams: validStreams(streams.value),
          };
          if (existing) data.channels[data.channels.findIndex((c) => c.id === existing.id)] = channel;
          else data.channels.push(channel);
          data.featured = data.featured.filter((id) => id !== channel.id);
          if (star.checked) data.featured.unshift(channel.id);
          status.textContent = 'Guardando…';
          await saveFile(`admin: ${existing ? 'editar' : 'añadir'} ${channel.name}`);
          rerender();
        } catch (err) {
          status.textContent = err.message;
          status.className = 'error';
          if (err.status === 409 || err.status === 422) await loadFile();
        }
      },
    },
    el('h2', {}, existing ? `Editar ${existing.name}` : 'Añadir canal o evento'),
    field('Nombre', name, 'Por ejemplo «Final Copa Regional» o «Canal Menciana».'),
    field('Categoría', group, 'Elige una o escribe una nueva. Por defecto: Calamar TV.'),
    groupList,
    field('Logo (opcional)', logo),
    field('Enlaces', streams, 'Uno por línea. La web reproduce .m3u8 por https; la app también .ts, http y páginas de reproductor. Si hay varios, se prueban en orden.'),
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
                if (!confirm(`¿Eliminar ${c.name}?`)) return;
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
    notice = err.message;
    if (err.status === 409 || err.status === 422) await loadFile();
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
                el('button', { class: 'btn small secondary', type: 'button', disabled: !c.playable && !star, onclick: () => { data.featured = star ? data.featured.filter((id) => id !== c.id) : [...data.featured, c.id]; guarded(() => saveFile(`admin: ${star ? 'quitar destacado' : 'destacar'} ${c.name}`), rerender); } }, star ? 'Quitar destacado' : 'Destacar'),
                el('button', { class: 'btn small secondary', type: 'button', onclick: () => { data.hidden = hidden ? data.hidden.filter((id) => id !== c.id) : [...data.hidden, c.id]; guarded(() => saveFile(`admin: ${hidden ? 'mostrar' : 'ocultar'} ${c.name}`), rerender); } }, hidden ? 'Mostrar' : 'Ocultar'),
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
  if (!token || !file) return loginView(rerender);
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
  const editing = decodeURIComponent(location.hash).match(/^#\/admin\/editar\/(.+)$/);
  const existing = editing ? file.data.channels.find((c) => c.id === editing[1]) : null;
  const shown = notice;
  notice = '';
  return [
    el(
      'section',
      { class: 'panel' },
      el('div', { class: 'section-head' }, el('h1', {}, 'Administración'), el('button', { class: 'ghost', type: 'button', onclick: () => { token = null; file = null; rerender(); } }, 'Cerrar sesión')),
      el('p', { class: 'lead' }, 'Los cambios se guardan en GitHub y se publican a la vez en la web y en la app.'),
      shown ? el('p', { class: shown.startsWith('Guardado') ? 'ok' : 'error', role: 'status' }, shown) : null,
      channelForm(existing, rerender),
      el('div', { class: 'section-head' }, el('h2', {}, 'Tus canales y eventos')),
      ownList(rerender),
      ...tdtTools(state, rerender),
    ),
  ];
}
