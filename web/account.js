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

const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/**
 * Sign-in, as a card: the brand, «Iniciar sesión» / «Crear cuenta», Google, and below «O continuar con»
 * the email and password (with «¿Olvidaste tu contraseña?» and the eye that shows it).
 */
function signIn(el, f, done) {
  let mode = 'login';
  const card = el('section', { class: 'auth-card' });
  const draw = () => {
    const note = el('p', { class: 'auth-note', role: 'status' });
    const say = (text, error = false) => { note.textContent = text; note.classList.toggle('error', error); };
    const busy = async (button, work) => {
      button.disabled = true; say('');
      try { await work(); done(); } catch (error) { say(f.explain(error), true); } finally { button.disabled = false; }
    };
    const creating = mode === 'create';
    const field = (label, input, extra = null) => el('label', { class: 'auth-field' }, el('span', { class: 'auth-label' }, el('span', {}, label), extra), input);
    const email = el('input', { type: 'email', autocomplete: 'email', required: true, placeholder: 'Tu email' });
    const password = el('input', { type: 'password', autocomplete: creating ? 'new-password' : 'current-password', minlength: '6', required: true, placeholder: 'Contraseña' });
    const name = el('input', { type: 'text', autocomplete: 'given-name', placeholder: 'Cómo te llamas', maxlength: '24' });
    const eye = el('button', { class: 'auth-eye', type: 'button', 'aria-label': 'Mostrar la contraseña', onclick: () => {
      const shown = password.type === 'text';
      password.type = shown ? 'password' : 'text';
      eye.setAttribute('aria-label', shown ? 'Mostrar la contraseña' : 'Ocultar la contraseña');
      eye.classList.toggle('on', !shown);
    } });
    eye.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    const forgot = creating ? null : el('button', { class: 'auth-link', type: 'button', onclick: async () => {
      if (!email.value.trim()) { say('Escribe tu email y vuelve a pulsar «¿Olvidaste tu contraseña?».', true); email.focus(); return; }
      try { await f.resetPassword(email.value.trim()); say(`Te hemos enviado un correo a ${email.value.trim()} para cambiar la contraseña.`); }
      catch (error) { say(f.explain(error), true); }
    } }, '¿Olvidaste tu contraseña?');
    const submit = el('button', { class: 'auth-submit', type: 'submit' }, creating ? 'Crear cuenta' : 'Iniciar sesión');
    const google = el('button', { class: 'auth-provider', type: 'button', onclick: () => busy(google, () => f.loginGoogle()) });
    google.innerHTML = GOOGLE_G;
    google.append('Google');
    const tab = (key, label) => el('button', { class: 'auth-tab', type: 'button', role: 'tab', 'aria-selected': String(mode === key),
      onclick: () => { if (mode !== key) { mode = key; draw(); } } }, label);
    card.replaceChildren(
      el('div', { class: 'auth-brand' }, el('img', { src: './assets/calamar-menciano-tv.png', alt: '', width: '64', height: '64' }),
        el('span', {}, el('b', {}, 'Calamar TV'), el('small', {}, 'Tu televisión, fútbol y cine'))),
      el('div', { class: 'auth-tabs', role: 'tablist' }, tab('login', 'Iniciar sesión'), tab('create', 'Crear cuenta')),
      el('h1', {}, creating ? 'Crea tu cuenta' : 'Entra'),
      el('p', { class: 'auth-lead' }, creating ? 'Regístrate con:' : 'Inicia sesión o regístrate con:'),
      google,
      el('div', { class: 'auth-divider' }, el('span', {}, 'O continuar con')),
      el('p', { class: 'auth-method' }, 'Email y contraseña'),
      el('form', { class: 'auth-form', onsubmit: (event) => {
        event.preventDefault();
        busy(submit, () => {
          if (!email.value.trim() || password.value.length < 6) throw Error('Escribe tu email y una contraseña de al menos 6 caracteres.');
          return creating ? f.registerEmail(email.value.trim(), password.value, name.value.trim()) : f.loginEmail(email.value.trim(), password.value);
        });
      } },
        creating ? field('Nombre', name) : null,
        field('Email', email),
        field('Contraseña', el('span', { class: 'auth-password' }, password, eye), forgot),
        submit),
      note);
  };
  draw();
  return [card, el('p', { class: 'auth-foot' }, 'Con tu cuenta, lo que ves, tu lista, tus «Me gusta» y tus canales favoritos te siguen en la web, el móvil y la tele. ',
    el('a', { href: '#/admin' }, 'Administración'))];
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

const ICON = {
  account: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 4"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/></svg>',
  admin: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l8 3v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z"/></svg>',
  out: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/></svg>',
};
const svg = (el, name, cls = '') => { const span = el('span', { class: cls, 'aria-hidden': 'true' }); span.innerHTML = ICON[name]; return span; };

/**
 * #/cuenta. Without an account: the sign-in. With one, as the «Perfil» sheet of Netflix: the profile watching
 * (✎ to edit it), the others and «Añadir», «Administrar perfiles», and «Cuenta», «Ayuda», «Administración»
 * (for the administrator) and «Cerrar sesión». `chosen` runs after picking a profile (back to the home page).
 */
export function accountPage(el, f, { rerender, chosen, editing = null, setEditing = () => {} }) {
  const user = signedUser();
  if (!user) return signIn(el, f, rerender);
  const note = el('p', { class: 'note', role: 'status' });
  const say = (text, error = false) => { note.textContent = text; note.classList.toggle('error', error); };
  const profiles = accountProfiles();
  const current = activeProfile();
  const go = (what) => { setEditing(what); rerender(); };
  const close = el('button', { class: 'sheet-close', type: 'button', 'aria-label': 'Cerrar', onclick: () => { setEditing(null); location.hash = '#/'; } }, '✕');
  const head = (title, back = null) => el('header', { class: 'sheet-head' },
    back ? el('button', { class: 'sheet-back', type: 'button', 'aria-label': 'Volver', onclick: () => go(back) }, '‹') : el('span'), el('h1', {}, title), close);
  if (editing === 'new' || (editing && profiles.some((p) => p.id === editing))) {
    const profile = editing === 'new' ? null : profiles.find((p) => p.id === editing);
    return [el('section', { class: 'profile-sheet' }, head(profile ? 'Editar perfil' : 'Añadir perfil', 'perfil'),
      profileForm(el, profile, () => go(null), say), note)];
  }
  if (editing === 'all' || !current) {
    const managing = editing === 'all';
    const tiles = profiles.map((p) => el('button', { class: `profile-tile${p.id === current?.id ? ' current' : ''}`, type: 'button',
      'aria-label': managing ? `Editar ${p.name}` : `Ver como ${p.name}`,
      onclick: async () => { if (managing) { go(p.id); return; } await chooseProfile(p.id); chosen(); } },
      avatar(el, p, 'big'), el('span', { class: 'profile-name' }, p.name), managing ? el('span', { class: 'profile-edit', 'aria-hidden': 'true' }, '✎') : null));
    if (profiles.length < MAX_PROFILES) tiles.push(el('button', { class: 'profile-tile add', type: 'button', onclick: () => go('new') },
      el('span', { class: 'profile-avatar big add', 'aria-hidden': 'true' }, '+'), el('span', { class: 'profile-name' }, 'Añadir perfil')));
    return [el('section', { class: 'profile-sheet' }, head(managing ? 'Administrar perfiles' : '¿Quién está viendo?', managing ? 'perfil' : null),
      el('div', { class: 'profile-grid' }, tiles),
      managing ? el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => go(null) }, 'Listo')) : null, note)];
  }
  if (editing === 'cuenta') {
    const provider = (user.providerData || []).some((p) => p.providerId === 'google.com') ? 'Google' : 'Email y contraseña';
    return [el('section', { class: 'profile-sheet' }, head('Cuenta', 'perfil'),
      el('dl', { class: 'sheet-facts' }, el('dt', {}, 'Email'), el('dd', {}, user.email || '—'), el('dt', {}, 'Acceso'), el('dd', {}, provider),
        el('dt', {}, 'Perfiles'), el('dd', {}, `${profiles.length} de ${MAX_PROFILES}`)),
      provider === 'Google' ? null : el('button', { class: 'btn secondary', type: 'button', onclick: async () => {
        try { await f.resetPassword(user.email); say(`Te hemos enviado un correo a ${user.email} para cambiar la contraseña.`); } catch (error) { say(f.explain(error), true); }
      } }, 'Cambiar la contraseña'), note)];
  }
  if (editing === 'ayuda') {
    const qa = (q, a) => el('details', { class: 'sheet-help' }, el('summary', {}, q), el('p', {}, a));
    return [el('section', { class: 'profile-sheet' }, head('Ayuda', 'perfil'),
      qa('¿Para qué sirven los perfiles?', 'Cada perfil tiene su «Continuar viendo», su lista, sus «Me gusta», sus canales favoritos y sus recomendaciones. Una cuenta puede tener hasta cinco.'),
      qa('¿Cómo entro en la tele?', 'En la app de la tele, abre Mi cuenta → «Iniciar sesión con el móvil», enfoca el QR con el móvil y confirma el código con tu cuenta de Google. También puedes escribir tu email y contraseña.'),
      qa('Un vídeo no se oye en el navegador', 'Algunos vídeos MKV traen un audio que los navegadores no reproducen. En la app Calamar TV se oyen bien.'),
      qa('He olvidado la contraseña', 'En «Entrar», escribe tu email y pulsa «¿Olvidaste tu contraseña?»: te llegará un correo para cambiarla.'))];
  }
  const others = profiles.filter((p) => p.id !== current.id).map((p) => el('button', { class: 'sheet-profile', type: 'button', 'aria-label': `Cambiar a ${p.name}`,
    onclick: async () => { await chooseProfile(p.id); rerender(); } }, avatar(el, p, 'mid'), el('span', {}, p.name)));
  if (profiles.length < MAX_PROFILES) others.push(el('button', { class: 'sheet-profile', type: 'button', onclick: () => go('new') },
    el('span', { class: 'profile-avatar mid tool', 'aria-hidden': 'true' }, '+'), el('span', {}, 'Añadir')));
  const item = (icon, label, action) => el('li', {}, el('button', { class: 'sheet-item', type: 'button', onclick: action }, svg(el, icon, 'sheet-icon'), el('span', {}, label), el('span', { class: 'sheet-chevron', 'aria-hidden': 'true' }, '›')));
  return [el('section', { class: 'profile-sheet' }, head('Perfil'),
    el('div', { class: 'sheet-current' },
      el('button', { class: 'sheet-edit', type: 'button', 'aria-label': `Editar ${current.name}`, onclick: () => go(current.id) }, svg(el, 'pencil')),
      avatar(el, current, 'big'), el('p', { class: 'sheet-name' }, current.name), el('p', { class: 'sheet-mail' }, user.email || user.displayName || '')),
    el('div', { class: 'sheet-profiles' }, others),
    el('button', { class: 'sheet-manage', type: 'button', onclick: () => go('all') }, 'Administrar perfiles'),
    el('ul', { class: 'sheet-menu' },
      item('account', 'Cuenta', () => go('cuenta')),
      item('help', 'Ayuda', () => go('ayuda')),
      f.administrator?.(user) ? item('admin', 'Administración', () => { setEditing(null); location.hash = '#/admin'; }) : null,
      item('out', 'Cerrar sesión', async () => { await f.logout(); setEditing(null); rerender(); })),
    note)];
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
 * «Elige tu perfil», as in Netflix, each time a signed-in account opens the web: the weekly top behind, one
 * title after another every few seconds while it is open (`slides`: { title, image, label }), the profiles,
 * «Añadir» and «Modificar».
 */
export function profileGate(el, { slides = [], chosen, manage }) {
  const tiles = accountProfiles().map((p) => el('button', { class: 'gate-profile', type: 'button', 'aria-label': `Ver como ${p.name}`,
    onclick: async () => { await chooseProfile(p.id); chosen(); } }, avatar(el, p, 'big'), el('span', {}, p.name)));
  const tool = (symbol, label, action) => el('button', { class: 'gate-profile gate-tool', type: 'button', onclick: action },
    el('span', { class: 'profile-avatar big tool', 'aria-hidden': 'true' }, symbol), el('span', {}, label));
  const tools = [accountProfiles().length < MAX_PROFILES ? tool('+', 'Añadir', () => manage('new')) : null, tool('✎', 'Modificar', () => manage('all'))];
  const backdrops = slides.map((slide, i) => el('div', { class: `gate-slide${i === 0 ? ' on' : ''}`, style: `background-image:url("${slide.image.replace(/"/g, '%22')}")` }));
  const title = el('p', { class: 'gate-title' }), rank = el('span', { class: 'gate-rank-text' });
  const feature = el('div', { class: 'gate-feature', 'aria-live': 'polite' }, title,
    el('p', { class: 'gate-rank' }, el('span', { class: 'gate-top', 'aria-hidden': 'true' }, 'TOP', el('b', {}, '10')), rank));
  let at = 0;
  const show = (i) => {
    backdrops.forEach((b, n) => b.classList.toggle('on', n === i));
    title.textContent = slides[i]?.title || '';
    rank.textContent = slides[i]?.label || '';
    feature.hidden = !slides[i];
  };
  show(0);
  const gate = el('div', { class: 'profile-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Elige tu perfil' },
    el('div', { class: 'gate-slides', 'aria-hidden': 'true' }, backdrops), feature,
    el('div', { class: 'gate-panel' }, el('h1', {}, 'Elige tu perfil'),
      el('div', { class: 'gate-profiles' }, tiles), el('div', { class: 'gate-profiles gate-tools' }, tools.filter(Boolean))));
  // A new title every 6 seconds while it is open; it stops once the gate is gone.
  if (slides.length > 1) {
    const timer = setInterval(() => {
      if (!gate.isConnected && at > 0) { clearInterval(timer); return; }
      at = (at + 1) % slides.length;
      show(at);
    }, 6000);
  }
  return gate;
}
