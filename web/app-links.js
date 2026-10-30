/** Android's verified links open directly. This button also works in browsers which keep links inside a tab. */
export function appIntent(address) {
  const url = new URL(address);
  if (url.username || url.password || url.port || url.protocol !== 'https:' || url.hostname !== 'djyuanyo.github.io' || !url.pathname.startsWith('/Calamar-TV/')) return null;
  const route = url.hash.replace(/^#\/?/, '') || url.pathname.slice('/Calamar-TV/'.length).replace(/\/$/, '');
  if (!/^(?:(?:liga|evento|canal)\/[\p{L}\p{N}_%+ .-]+|directo|canales|peliculas|series|documentales)?$/u.test(route)) return null;
  return `intent://open/${route}#Intent;scheme=calamartv;package=es.yuanyo.calamartv;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}

export function updateOpenApp() {
  let button = document.getElementById('open-in-app');
  if (!button) {
    button = document.createElement('a'); button.id = 'open-in-app'; button.className = 'open-in-app';
    button.textContent = 'Abrir en la app'; document.querySelector('main').before(button);
  }
  const address = /Android/i.test(navigator.userAgent) ? appIntent(location.href) : null;
  button.hidden = !address;
  if (address) button.href = address;
}
