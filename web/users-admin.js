import { mergeUserDirectory, findUsers } from './access-policy.js';
import { madridDay } from './audience.js';
import { fetchLibrary, itemTitle, LIBRARY_SECTIONS } from './library.js';
import { viewerDevice } from './user-playback.js';

const asDate = value => {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);
  return date && Number.isFinite(date.getTime()) ? date : null;
};
const format = (value, options) => asDate(value)?.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', ...options }) || 'Sin datos';
const name = user => user.name || user.profiles?.[0]?.name || 'Usuario';
const email = user => user.email || 'Correo pendiente';
const uidPath = uid => '#/admin/usuarios/' + encodeURIComponent(uid);
const button = (el, title, click) => el('button', { class: 'btn secondary', type: 'button', onclick: click }, title);

function accessSettings(el, service) {
  const note = el('p', { class: 'note', role: 'status' }, 'Cargando configuración…');
  const required = el('input', { type: 'checkbox', role: 'switch', disabled: true });
  const describe = () => required.checked
    ? 'Se requiere iniciar sesión en la web, Android y Android TV.'
    : 'Se puede entrar como invitado en la web, Android y Android TV.';
  service.readWebAccess().then(policy => {
    required.checked = policy.requireLogin;
    required.disabled = false;
    note.textContent = describe();
  }).catch(error => { note.textContent = service.explain(error); });
  required.addEventListener('change', async () => {
    required.disabled = true;
    const next = required.checked;
    note.textContent = 'Guardando…';
    try {
      await service.saveWebAccess({ requireLogin: next });
      note.textContent = describe();
    } catch (error) {
      required.checked = !next;
      note.textContent = service.explain(error);
    } finally { required.disabled = false; }
  });
  return el('section', { class: 'user-surface users-access' },
    el('h2', {}, 'Acceso a Calamar TV'),
    el('label', { class: 'access-switch' }, required, el('b', {}, 'Exigir una cuenta para entrar')),
    note);
}

function directory(el, service) {
  const search = el('input', { type: 'search', placeholder: 'Nombre o correo', 'aria-label': 'Buscar usuarios' });
  const status = el('p', { class: 'note', role: 'status' }, 'Cargando usuarios…');
  const rows = el('div', { class: 'users-list' });
  const pages = el('div', { class: 'actions' });
  let users = [], page = 0;
  const draw = () => {
    const found = findUsers(users, search.value), size = 30;
    page = Math.max(0, Math.min(page, Math.ceil(found.length / size) - 1));
    status.textContent = `${found.length} ${found.length === 1 ? 'usuario' : 'usuarios'}`;
    rows.replaceChildren(...found.slice(page * size, (page + 1) * size).map(user =>
      el('article', { class: 'user-card' },
        el('div', { class: 'user-card-head' },
          el('div', { class: 'user-initial', 'aria-hidden': 'true' }, name(user).slice(0, 1).toLocaleUpperCase('es')),
          el('div', { class: 'user-identity' }, el('h3', {}, name(user)), el('p', {}, email(user))),
          user.blocked ? el('span', { class: 'user-status blocked' }, 'Bloqueado')
            : user.provider === 'password' && user.verified === false ? el('span', { class: 'user-status' }, 'Correo sin verificar') : null),
        el('a', { class: 'btn secondary', href: uidPath(user.uid), 'aria-label': `Editar a ${name(user)}` }, 'Editar'))));
    if (!found.length) rows.append(el('p', { class: 'note' }, 'No hay usuarios con ese nombre o correo.'));
    pages.replaceChildren();
    if (found.length > size) {
      const back = button(el, 'Anterior', () => { page--; draw(); });
      const next = button(el, 'Siguiente', () => { page++; draw(); });
      back.disabled = page === 0;
      next.disabled = (page + 1) * size >= found.length;
      pages.append(back, el('span', {}, `Página ${page + 1} de ${Math.ceil(found.length / size)}`), next);
    }
  };
  const load = async () => {
    reload.disabled = true;
    try {
      const data = await service.readUserDirectory();
      users = mergeUserDirectory(data.members, data.profiles, data.access);
      draw();
    } catch (error) {
      status.textContent = service.explain(error);
    } finally { reload.disabled = false; }
  };
  const reload = button(el, 'Actualizar', load);
  search.addEventListener('input', () => { page = 0; draw(); });
  void load();
  return el('section', {},
    el('h2', {}, 'Cuentas'),
    el('div', { class: 'users-tools' }, search, reload), status, rows, pages);
}

function accessAction(el, service, user) {
  const self = user.uid === service.auth.currentUser?.uid;
  const note = el('p', { class: 'note', role: 'status' });
  const status = el('span', { class: 'user-status' });
  const action = button(el, '', async () => {
    action.disabled = true;
    try {
      await service.setUserBlocked(user.uid, !user.blocked);
      user.blocked = !user.blocked;
      draw();
    } catch (error) { note.textContent = service.explain(error); }
    finally { action.disabled = self; }
  });
  const remove = self ? null : button(el, 'Eliminar cuenta', () => {
    const confirmed = window.confirm(`¿Eliminar la cuenta de ${name(user)} (${user.email || user.uid})? Se cerrará su acceso y la eliminación no se puede deshacer. Google te pedirá confirmar tu identidad.`);
    if (!confirmed) return;
    action.disabled = remove.disabled = true;
    note.textContent = 'Eliminando cuenta…';
    service.deleteUserAccount(user.uid).then(() => {
      location.hash = '#/admin/usuarios';
    }).catch(error => { note.textContent = service.explain(error); })
      .finally(() => { action.disabled = remove.disabled = false; });
  });
  remove?.classList.add('user-delete');
  const draw = () => {
    status.textContent = self ? 'Administrador' : user.blocked ? 'Acceso bloqueado' : 'Acceso activo';
    status.classList.toggle('blocked', user.blocked);
    action.textContent = self ? 'Tu cuenta' : user.blocked ? 'Desbloquear acceso' : 'Bloquear acceso';
  };
  action.disabled = self;
  draw();
  return el('div', { class: 'user-access-actions' }, status, action, remove, note);
}

function favoriteLists(el, profile, names) {
  const favorites = Object.keys(profile.data?.favorites || {});
  const saved = Object.values(profile.data?.list || {}).filter(item => typeof item?.item === 'string');
  const items = [
    ...favorites.map(id => ['Canal', names.get(id) || id]),
    ...saved.map(item => ['Mi lista', names.get(item.item) || item.item]),
  ];
  return el('details', { class: 'user-favorites', open: '' },
    el('summary', {}, profile.name || 'Perfil'),
    items.length ? el('ul', { class: 'user-entries' }, items.map(([kind, title]) =>
      el('li', {}, el('b', {}, title), el('small', {}, kind)))) : el('p', { class: 'note' }, 'Este perfil todavía no tiene favoritos.'));
}

function historyPanel(el, service, uid) {
  const rows = el('div', { class: 'user-history' });
  const note = el('p', { class: 'note', role: 'status' }, 'Cargando reproducciones…');
  const entries = [];
  let cursor = null;
  const more = button(el, 'Cargar más', () => load());
  more.hidden = true;
  const draw = () => {
    const groups = new Map();
    for (const entry of entries) {
      const day = asDate(entry.startedAt);
      const key = day ? madridDay(day) : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    rows.replaceChildren(...[...groups.values()].map(group =>
      el('section', { class: 'user-day' },
        el('h3', {}, format(group[0].startedAt, { dateStyle: 'full' })),
        el('ul', { class: 'user-entries' }, group.map(entry => el('li', {},
          el('b', {}, entry.title || entry.target.slice(2)),
          el('small', {}, [format(entry.startedAt, { timeStyle: 'short' }),
            entry.endedAt ? 'Fin ' + format(entry.endedAt, { timeStyle: 'short' }) : '',
            viewerDevice(entry.device), entry.profile].filter(Boolean).join(' · '))))))));
  };
  const load = async () => {
    more.disabled = true;
    try {
      const result = await service.readViewingHistory(uid, cursor);
      entries.push(...result.entries);
      cursor = result.cursor;
      draw();
      note.textContent = entries.length ? 'Horas de España peninsular.' : 'Todavía no hay reproducciones registradas.';
      more.hidden = !cursor;
    } catch (error) { note.textContent = service.explain(error); }
    finally { more.disabled = false; }
  };
  void load();
  return el('section', { class: 'user-surface' }, el('h2', {}, 'Historial de reproducción'), note, rows, more);
}

function userDetails(el, service, state, uid) {
  const panel = el('div', { class: 'user-detail' }, el('p', { class: 'note', role: 'status' }, 'Cargando cuenta…'));
  service.readUserDetails(uid).then(user => {
    if (!user) { panel.replaceChildren(el('p', { class: 'note' }, 'No se ha encontrado la cuenta.')); return; }
    const provider = { 'google.com': 'Google', password: 'Correo y contraseña' }[user.provider] || 'Sin datos';
    const details = [
      ['Registro', format(user.registeredAt, { dateStyle: 'medium', timeStyle: 'short' })],
      ['Último acceso', format(user.lastSeen, { dateStyle: 'medium', timeStyle: 'short' })],
      ['Método de acceso', provider],
      ...(user.provider === 'password' ? [['Correo', user.verified ? 'Verificado' : 'Sin verificar']] : []),
      ['Perfiles', String(user.profiles.length)],
    ];
    const names = new Map((state.channels || []).map(channel => [channel.id, channel.name]));
    const favorites = el('section', { class: 'user-surface' }, el('h2', {}, 'Favoritos'));
    const favoritesBody = el('div', {});
    const drawFavorites = () => favoritesBody.replaceChildren(...(user.profiles.length
      ? user.profiles.map(profile => favoriteLists(el, profile, names))
      : [el('p', { class: 'note' }, 'Esta cuenta todavía no tiene perfiles.')]));
    favorites.append(favoritesBody);
    drawFavorites();
    if (user.profiles.some(profile => Object.keys(profile.data?.list || {}).length)) fetchLibrary().then(library => {
      for (const section of LIBRARY_SECTIONS) for (const item of library.sections?.[section.key] || []) names.set(item.id, itemTitle(item));
      drawFavorites();
    }).catch(() => {});
    panel.replaceChildren(
      el('header', { class: 'user-surface' }, el('h1', {}, name(user)), el('p', { class: 'note' }, email(user)),
        el('dl', { class: 'user-facts' }, details.flatMap(([label, value]) =>
          [el('dt', {}, label), el('dd', {}, value)])),
        accessAction(el, service, user)),
      favorites, historyPanel(el, service, uid));
  }).catch(error => panel.replaceChildren(el('p', { class: 'error' }, service.explain(error))));
  return panel;
}

export function usersAdmin(el, service, state, uid) {
  return [el('section', { class: 'users-page' },
    el('a', { class: 'ghost user-back', href: uid ? '#/admin/usuarios' : '#/admin' }, uid ? '‹ Volver a usuarios' : '‹ Administración'),
    ...(uid ? [userDetails(el, service, state, uid)] : [el('h1', {}, 'Usuarios'), accessSettings(el, service), directory(el, service)]))];
}
