/** Stable signed release asset: GitHub resolves "latest" each time it is downloaded. */
export const APK_DOWNLOAD = 'https://github.com/djyuanyo/Calamar-TV/releases/latest/download/Calamar-TV.apk';
export const TIZEN_DOWNLOAD = 'downloads/Calamar-TV-Tizen.wgt';

export function isSamsungTizen(userAgent = '') {
  return /\bTizen\b/i.test(userAgent) && /\b(?:Smart[- ]?TV|TV Safari)\b/i.test(userAgent)
    && !/\b(?:Android|Mobile)\b/i.test(userAgent);
}

export function updateAppDownload() {
  if (document.documentElement.dataset.platform === 'tizen') return;
  let button = document.getElementById('download-app');
  if (!button) {
    const samsung = isSamsungTizen(navigator.userAgent);
    button = document.createElement('a'); button.id = 'download-app'; button.className = 'download-app';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', samsung ? 'M2 4h20v14H2zm2 2v10h16V6zm3 14h10v2H7z'
      : 'm17.6 9.48 1.84-3.18a.63.63 0 0 0-1.09-.63l-1.88 3.25a11.5 11.5 0 0 0-8.94 0L5.65 5.67a.63.63 0 0 0-1.09.63L6.4 9.48A10.7 10.7 0 0 0 1 18h22a10.7 10.7 0 0 0-5.4-8.52ZM7.5 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm9 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z');
    if (samsung) path.setAttribute('fill-rule', 'evenodd');
    svg.append(path);
    const badge = document.createElement('span');
    badge.className = 'download-app-icon';
    badge.append(svg);
    const copy = document.createElement('span');
    copy.className = 'download-app-copy';
    const label = document.createElement('strong');
    label.textContent = samsung ? 'Descargar para Samsung TV' : 'Descargar APP Android';
    const platform = document.createElement('small');
    platform.textContent = samsung ? 'Tizen · WGT para firmar e instalar con Tizen Studio' : 'Android y Android TV';
    platform.setAttribute('aria-hidden', 'true');
    copy.append(label, platform);
    const arrow = document.createElementNS(svg.namespaceURI, 'svg');
    arrow.classList.add('download-app-arrow');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('aria-hidden', 'true');
    const arrowPath = document.createElementNS(svg.namespaceURI, 'path');
    arrowPath.setAttribute('d', 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4');
    arrow.append(arrowPath);
    button.append(badge, copy, arrow);
    button.href = samsung ? TIZEN_DOWNLOAD : APK_DOWNLOAD;
    document.getElementById('view').before(button);
    if (samsung) {
      button.download = 'Calamar-TV-Tizen.wgt';
      const help = document.createElement('a');
      help.className = 'tizen-install-link';
      help.href = 'samsung-tv.html';
      help.textContent = 'Cómo instalar en Samsung TV';
      button.after(help);
    }
  }
}
