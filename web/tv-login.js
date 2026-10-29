// The page the app's QR or short link opens on a phone: confirm the code the app shows and sign in with Google.
import { deviceKey } from './device-login.js';

export async function render(el, keyText, codeText) {
  const key = deviceKey(keyText);
  const title = el('h2', {}, 'Iniciar sesión en la app');
  if (!key) return [title, el('p', { class: 'error' }, 'Este enlace no es válido. Abre el QR o el enlace que muestra la app Calamar TV, en Mi cuenta (o Administración) → Iniciar sesión con el móvil.')];
  const { publishDeviceLogin, watchDeviceLogin, explain } = await import('./firebase.js');
  const code = el('input', { type: 'text', value: deviceKey(codeText) || '', maxlength: '5', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    class: 'device-code-input', 'aria-label': 'Código que muestra la app', placeholder: 'AB3D' });
  const note = el('p', { class: 'note', role: 'status' });
  const confirm = el('button', { class: 'btn', type: 'submit' }, 'Confirmar e iniciar sesión con Google');
  const form = el('form', { class: 'device-login', onsubmit: async (event) => {
    event.preventDefault();
    const typed = deviceKey(code.value);
    if (!typed) { note.textContent = 'Escribe los 4 caracteres que muestra la app (letras y números).'; code.focus(); return; }
    confirm.disabled = true; note.textContent = 'Abriendo Google…';
    try {
      await publishDeviceLogin(key + typed);
      note.textContent = 'Esperando a la app…';
      const stop = watchDeviceLogin(key + typed, (exists) => {
        if (exists !== false) return;
        stop();
        form.replaceWith(el('div', { class: 'device-login' }, el('p', { class: 'device-done' }, '✓ Listo: la app ya tiene la sesión iniciada.'), el('p', { class: 'note' }, 'Puedes cerrar esta página.')));
      });
    } catch (error) {
      note.textContent = error.code ? explain(error) : error.message;
      confirm.disabled = false;
    }
  } }, el('label', { class: 'device-code-label' }, 'Código que muestra la app', code), el('div', { class: 'actions' }, confirm), note);
  return [title, el('p', { class: 'note' }, `Comprueba que el código es el mismo que ves en la app${codeText ? '' : ' y escríbelo'}, y entra con tu cuenta de Google.`), form];
}
