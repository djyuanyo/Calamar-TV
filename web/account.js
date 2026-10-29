// «Mi cuenta» (#/cuenta): sign in with Google or with email and password, «¿Quién está viendo?» and
// the profiles of the account (add, rename, colour, delete), as in Netflix.
import { MAX_PROFILES, PROFILE_COLORS, signedUser, accountProfiles, activeProfile, chooseProfile, addProfile, editProfile, removeProfile } from './profiles.js';

export const profileInitial = (profile) => String(profile?.name || '?').trim().charAt(0).toLocaleUpperCase('es') || '?';

function avatar(el, profile, size = '') {
  return el('span', { class: `profile-avatar${size ? ` ${size}` : ''}`, style: `--profile:${profile.color}`, 'aria-hidden': 'true' }, profileInitial(profile));
}

function colorPicker(el, chosen) {
  let value = chosen;
  const buttons = PROFILE_COLORS.map((color) => el('button', { type: 'button', class: 'color-dot', style: `--profile:${color}`,
    'aria-label': `Color ${PROFILE_COLORS.indexOf(color) + 1}`, 'aria-pressed': String(color === chosen),
    onclick: () => { value = color; for (const b of buttons) b.setAttribute('aria-pressed', String(b === buttons[PROFILE_COLORS.indexOf(color)])); } }));
  return { node: el('div', { class: 'color-picker', role: 'group', 'aria-label': 'Color del perfil' }, buttons), value: () => value };
}

/** Sign-in: «Continuar con Google», or email and password (entrar, crear cuenta, recuperar la contraseña). */
function signIn(el, f, done) {
  const note = el('p', { class: 'note', role: 'status' });
  const say = (text, error = false) => { note.textContent = text; note.classList.toggle('error', error); };
  const busy = async (button, work) => {
    button.disabled = true; say('');
    try { await work(); done(); } catch (error) { say(f.explain(error), true); } finally { button.disabled = false; }
  };
  const email = el('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'Correo electrónico', 'aria-label': 'Correo electrónico' });
  const password = el('input', { type: 'password', autocomplete: 'current-password', minlength: '6', placeholder: 'Contraseña', 'aria-label': 'Contraseña' });
  const name = el('input', { type: 'text', autocomplete: 'given-name', placeholder: 'Tu nombre (para crear la cuenta)', 'aria-label': 'Tu nombre', maxlength: '24' });
  const google = el('button', { class: 'btn lg google-btn', type: 'button', onclick: () => busy(google, () => f.loginGoogle()) }, 'Continuar con Google');
  const enter = el('button', { class: 'btn', type: 'submit' }, 'Entrar');
  const create = el('button', { class: 'btn secondary', type: 'button', onclick: () => busy(create, () => {
    if (!email.value.trim() || password.value.length < 6) throw Error('Escribe tu correo y una contraseña de al menos 6 caracteres.');
    return f.registerEmail(email.value.trim(), password.value, name.value.trim());
  }) }, 'Crear cuenta');
  const forgot = el('button', { class: 'link-button', type: 'button', onclick: async () => {
    if (!email.value.trim()) { say('Escribe tu correo y vuelve a pulsar «¿Has olvidado la contraseña?».', true); return; }
    try { await f.resetPassword(email.value.trim()); say(`Te hemos enviado un correo a ${email.value.trim()} para cambiar la contraseña.`); }
    catch (error) { say(f.explain(error), true); }
  } }, '¿Has olvidado la contraseña?');
  const form = el('form', { class: 'account-form', onsubmit: (event) => { event.preventDefault(); busy(enter, () => f.loginEmail(email.value.trim(), password.value)); } },
    email, password, name, el('div', { class: 'actions' }, enter, create), forgot);
  return [el('section', { class: 'account-card' },
    el('h1', {}, 'Entra en Calamar TV'),
    el('p', { class: 'note' }, 'Con tu cuenta, lo que estés viendo, «Mi lista», tus «Me gusta» y tus canales favoritos te siguen en cualquier dispositivo. Cada perfil tiene los suyos.'),
    google, el('p', { class: 'account-or' }, 'o con tu correo'), form, note)];
}

/** A profile's form: name and colour, «Guardar», and «Borrar perfil» (never the main one). */
function profileForm(el, profile, done, say) {
  const name = el('input', { type: 'text', maxlength: '24', value: profile?.name || '', placeholder: 'Nombre del perfil', 'aria-label': 'Nombre del perfil' });
  const colors = colorPicker(el, profile?.color || PROFILE_COLORS[accountProfiles().length % PROFILE_COLORS.length]);
  const save = el('button', { class: 'btn', type: 'submit' }, profile ? 'Guardar' : 'Añadir perfil');
  const remove = profile && profile.id !== 'main' ? el('button', { class: 'btn secondary danger', type: 'button', onclick: async () => {
    if (!confirm(`¿Borrar el perfil «${profile.name}» con su historial, su lista y sus «Me gusta»?`)) return;
    try { await removeProfile(profile.id); done(); } catch (error) { say(error.message, true); }
  } }, 'Borrar perfil') : null;
  return el('form', { class: 'profile-form', onsubmit: async (event) => {
    event.preventDefault(); save.disabled = true;
    try { if (profile) await editProfile(profile.id, name.value, colors.value()); else await addProfile(name.value, colors.value()); done(); }
    catch (error) { say(error.message, true); } finally { save.disabled = false; }
  } }, name, colors.node, el('div', { class: 'actions' }, save, remove, el('button', { class: 'btn secondary', type: 'button', onclick: done }, 'Cancelar')));
}

/**
 * #/cuenta. `rerender` draws the page again; `chosen` runs after picking a profile (back to the home page).
 * Without an account: the sign-in. With one: «¿Quién está viendo?», «Administrar perfiles» and «Cerrar sesión».
 */
export function accountPage(el, f, { rerender, chosen, editing = null, setEditing = () => {} }) {
  const user = signedUser();
  if (!user) return signIn(el, f, rerender);
  const note = el('p', { class: 'note', role: 'status' });
  const say = (text, error = false) => { note.textContent = text; note.classList.toggle('error', error); };
  const profiles = accountProfiles();
  const current = activeProfile();
  const managing = editing === 'all';
  if (editing && editing !== 'all') {
    const profile = editing === 'new' ? null : profiles.find((p) => p.id === editing);
    return [el('section', { class: 'account-card' }, el('h1', {}, profile ? 'Editar perfil' : 'Añadir perfil'),
      profileForm(el, profile, () => { setEditing(profile ? 'all' : null); rerender(); }, say), note)];
  }
  const tiles = profiles.map((p) => el('button', { class: `profile-tile${p.id === current?.id ? ' current' : ''}`, type: 'button',
    'aria-label': managing ? `Editar ${p.name}` : `Ver como ${p.name}`,
    onclick: async () => { if (managing) { setEditing(p.id); rerender(); return; } await chooseProfile(p.id); chosen(); } },
    avatar(el, p, 'big'), el('span', { class: 'profile-name' }, p.name), managing ? el('span', { class: 'profile-edit', 'aria-hidden': 'true' }, '✎') : null));
  if (profiles.length < MAX_PROFILES) tiles.push(el('button', { class: 'profile-tile add', type: 'button', onclick: () => { setEditing('new'); rerender(); } },
    el('span', { class: 'profile-avatar big add', 'aria-hidden': 'true' }, '+'), el('span', { class: 'profile-name' }, 'Añadir perfil')));
  return [el('section', { class: 'account-card who' },
    el('h1', {}, managing ? 'Administrar perfiles' : '¿Quién está viendo?'),
    el('div', { class: 'profile-grid' }, tiles),
    el('div', { class: 'actions' },
      el('button', { class: 'btn secondary', type: 'button', onclick: () => { setEditing(managing ? null : 'all'); rerender(); } }, managing ? 'Listo' : 'Administrar perfiles'),
      el('button', { class: 'btn secondary', type: 'button', onclick: async () => { await f.logout(); rerender(); } }, 'Cerrar sesión')),
    el('p', { class: 'note' }, `Cuenta: ${user.email || user.displayName || ''}`), note)];
}

/** The header button: «Entrar», or the avatar of the profile watching. */
export function paintAccountButton(el, link) {
  const profile = activeProfile();
  if (!signedUser()) { link.replaceChildren('Entrar'); link.title = 'Entrar o crear una cuenta'; link.setAttribute('aria-label', 'Entrar'); return; }
  link.replaceChildren(profile ? avatar(el, profile) : el('span', { class: 'profile-avatar' }, '?'));
  link.title = profile ? `${profile.name} · Cambiar de perfil` : '¿Quién está viendo?';
  link.setAttribute('aria-label', link.title);
}

/**
 * «Elige tu perfil», as in Netflix, each time a signed-in account opens the web: the film N.º 1 of the
 * week behind, the profiles, «Añadir» and «Modificar». `top` is { item } of that film (or null).
 */
export function profileGate(el, { top, chosen, manage }) {
  const info = top?.item?.tmdb || {};
  const art = info.backdrop || info.poster || '';
  const tiles = accountProfiles().map((p) => el('button', { class: 'gate-profile', type: 'button', 'aria-label': `Ver como ${p.name}`,
    onclick: async () => { await chooseProfile(p.id); chosen(); } }, avatar(el, p, 'big'), el('span', {}, p.name)));
  const tool = (symbol, label, action) => el('button', { class: 'gate-profile gate-tool', type: 'button', onclick: action },
    el('span', { class: 'profile-avatar big tool', 'aria-hidden': 'true' }, symbol), el('span', {}, label));
  const tools = [accountProfiles().length < MAX_PROFILES ? tool('+', 'Añadir', () => manage('new')) : null, tool('✎', 'Modificar', () => manage('all'))];
  return el('div', { class: 'profile-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Elige tu perfil', style: art ? `--gate-art:url("${art.replace(/"/g, '%22')}")` : null },
    el('div', { class: 'gate-feature' },
      top ? el('p', { class: 'gate-title' }, top.item.tmdb?.title || top.item.title) : null,
      top ? el('p', { class: 'gate-rank' }, el('span', { class: 'gate-top', 'aria-hidden': 'true' }, 'TOP', el('b', {}, '10')), 'N.º 1 en películas hoy') : null),
    el('div', { class: 'gate-panel' }, el('h1', {}, 'Elige tu perfil'),
      el('div', { class: 'gate-profiles' }, tiles), el('div', { class: 'gate-profiles gate-tools' }, tools.filter(Boolean))));
}
