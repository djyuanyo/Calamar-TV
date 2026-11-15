export const REMINDER_ENDPOINT = 'https://calamarmenciano.com/calamar-verificacion.php';

export function verificationCode(link, { authDomain, apiKey }) {
  let url;
  try { url = new URL(link); } catch {}
  const code = url?.searchParams.get('oobCode');
  if (url?.origin !== `https://${authDomain}` || url.username || url.password || url.pathname !== '/__/auth/action'
      || url.searchParams.get('mode') !== 'verifyEmail' || url.searchParams.get('apiKey') !== apiKey
      || !/^[A-Za-z0-9_-]{6,1024}$/.test(code || '')) throw Error('Firebase no devolvió un enlace de verificación válido.');
  return code;
}

export function verificationDraft(email, link) {
  const subject = 'Verifica tu correo de Calamar TV';
  const body = `Hola,\r\n\r\nConfirma tu correo para acceder a Calamar TV:\r\n${link}\r\n\r\nSi no has creado esta cuenta, puedes ignorar este mensaje.\r\n\r\nCalamar TV`;
  return `mailto:${encodeURIComponent(email).replace('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
