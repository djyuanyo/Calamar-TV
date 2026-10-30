/** Stable signed release asset: GitHub resolves "latest" each time it is downloaded. */
export const APK_DOWNLOAD = 'https://github.com/djyuanyo/Calamar-TV/releases/latest/download/Calamar-TV.apk';
export function updateAppDownload() {
  let button = document.getElementById('download-app');
  if (!button) {
    button = document.createElement('a'); button.id = 'download-app'; button.className = 'download-app';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm17.6 9.48 1.84-3.18a.63.63 0 0 0-1.09-.63l-1.88 3.25a11.5 11.5 0 0 0-8.94 0L5.65 5.67a.63.63 0 0 0-1.09.63L6.4 9.48A10.7 10.7 0 0 0 1 18h22a10.7 10.7 0 0 0-5.4-8.52ZM7.5 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm9 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z');
    svg.append(path); button.append(svg, document.createTextNode('Descargar aplicación'));
    button.href = APK_DOWNLOAD; document.querySelector('main').before(button);
  }
}
