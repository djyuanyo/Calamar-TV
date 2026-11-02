import { mergeUserDirectory, findUsers } from './access-policy.js';
const date = value => {
  const d = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }) : 'Sin datos todavía';
};
export function usersAdmin(el, f) {
  const settings = el('section', { class: 'users-access panel' }, el('h2', {}, 'Acceso a la web'));
  const policyNote = el('p', { class: 'note', role: 'status' }, 'Cargando configuración…');
  const required = el('input', { type: 'checkbox', role: 'switch', disabled: true });
  settings.append(el('label', { class: 'access-switch' }, required, el('b', {}, 'Exigir una cuenta para entrar en la web')), policyNote);
  f.readWebAccess().then(p => { required.checked = p.requireLogin; required.disabled = false; policyNote.textContent = p.requireLogin ? 'Los visitantes deben iniciar sesión o registrarse. La app Android mantiene su acceso actual.' : 'La web se puede visitar sin iniciar sesión, como hasta ahora.'; }).catch(e => { policyNote.textContent = f.explain(e); policyNote.classList.add('error'); });
  required.addEventListener('change', async () => {
    required.disabled = true; const next = required.checked; policyNote.textContent = 'Guardando…';
    try { await f.saveWebAccess({ requireLogin: next }); policyNote.textContent = next ? 'Guardado: es obligatorio iniciar sesión para acceder a la web.' : 'Guardado: la web permite entrar sin cuenta.'; }
    catch(e) { required.checked = !next; policyNote.textContent = f.explain(e); } finally { required.disabled = false; }
  });
  const panel = el('section', { class: 'panel users-panel' }, el('h2', {}, 'Usuarios'));
  const search = el('input', { type: 'search', placeholder: 'Buscar por nombre o correo', 'aria-label': 'Buscar usuarios' });
  const status = el('p', { class: 'note', role: 'status' }, 'Cargando usuarios…'), rows = el('div', { class: 'users-list' }), pages = el('div', { class: 'actions' });
  const reload = el('button', { class: 'ghost', type: 'button' }, 'Actualizar usuarios');
  panel.append(el('div', { class: 'users-tools' }, search, reload), status, rows, pages);
  let users = [], page = 0, busy = new Set();
  const draw = () => {
    const found = findUsers(users, search.value), size = 30;
    page = Math.max(0, Math.min(page, Math.ceil(found.length / size) - 1));
    status.textContent = `${found.length} usuarios · ${users.filter(u => u.blocked).length} bloqueados en la web`;
    rows.replaceChildren(...found.slice(page * size, (page + 1) * size).map(u => {
      const self = u.uid === f.auth.currentUser?.uid, name = u.name || u.email || 'Usuario';
      const note = el('p', { class: 'note', role: 'status' });
      const action = el('button', { class: 'btn secondary', type: 'button', disabled: self || busy.has(u.uid), 'aria-label': `${u.blocked ? 'Desbloquear' : 'Bloquear en la web'} a ${name}` }, self ? 'Tu cuenta' : u.blocked ? 'Desbloquear' : 'Bloquear en la web');
      action.addEventListener('click', async () => {
        busy.add(u.uid); action.disabled = true;
        try { await f.setUserBlocked(u.uid, !u.blocked); u.blocked = !u.blocked; }
        catch(e) { note.textContent = f.explain(e); busy.delete(u.uid); action.disabled = false; return; }
        busy.delete(u.uid); draw();
      });
      return el('article', { class: 'user-card' }, el('div', { class: 'user-card-head' }, el('b', {}, name), el('span', { class: `user-status${u.blocked ? ' blocked' : ''}` }, self ? 'Administrador' : u.blocked ? 'Bloqueado en la web' : 'Usuario')),
        el('p', {}, u.email || 'El correo se actualizará cuando vuelva a iniciar sesión.'),
        el('dl', {}, el('dt', {}, 'Registro'), el('dd', {}, date(u.registeredAt)), el('dt', {}, 'Último acceso'), el('dd', {}, date(u.lastSeen)), el('dt', {}, 'Perfiles'), el('dd', {}, String(u.profileCount || 0)), el('dt', {}, 'Inicio de sesión'), el('dd', {}, u.provider === 'google.com' ? 'Google' : u.provider === 'password' ? 'Email y contraseña' : 'Pendiente de actualizar')),
        action, note);
    }));
    if (!found.length) rows.append(el('p', { class: 'note' }, users.length ? 'No hay usuarios con ese nombre o correo.' : 'Todavía no hay cuentas con perfil.'));
    pages.replaceChildren();
    if (found.length > size) {
      const back = el('button', { class: 'ghost', type: 'button', disabled: page === 0, onclick: () => { page--; draw(); } }, 'Anterior');
      const next = el('button', { class: 'ghost', type: 'button', disabled: (page + 1) * size >= found.length, onclick: () => { page++; draw(); } }, 'Siguiente');
      pages.append(back, el('span', {}, `Página ${page + 1} de ${Math.ceil(found.length / size)}`), next);
    }
  };
  const load = async () => {
    reload.disabled = true;
    try { const d = await f.readUserDirectory(); users = mergeUserDirectory(d.members, d.profiles, d.access); draw(); }
    catch(e) { status.textContent = f.explain(e); status.classList.add('error'); }
    finally { reload.disabled = false; }
  };
  search.addEventListener('input', () => { page = 0; draw(); }); reload.addEventListener('click', load); void load();
  return [settings, panel];
}
