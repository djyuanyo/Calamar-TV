// Signing in an app (Android or Android TV) from a phone, as on Netflix: the app shows a QR, a short link
// with its key (djyuanyo.github.io/Calamar-TV/tv/K7Q2) and a 4-character code. On the phone the administrator
// signs in with Google and confirms the code (already filled in from the QR); the Google sign-in goes to
// calamarDeviceLogins/<key><code>, which only the app knows to ask for, and it signs in by itself.
// As DeviceLogin.java.
export const DEVICE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // No 0/O or 1/I: easy to read and type.
export const DEVICE_LOGIN_PATH = 'calamarDeviceLogins';
export const DEVICE_LOGIN_MINUTES = 5;

/** The app's key or code, upper case, or null when it is not 4 characters of the alphabet. */
export function deviceKey(text) {
  const key = String(text || '').replace(/[\s-]/g, '').toUpperCase();
  return new RegExp(`^[${DEVICE_ALPHABET}]{4}$`).test(key) ? key : null;
}
