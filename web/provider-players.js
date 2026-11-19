/** Provider player URLs accepted inside Calamar's video screen. */
function httpsUrl(address) {
  try {
    const url = new URL(String(address).trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

export function dailymotionEmbed(address) {
  const url = httpsUrl(address);
  if (!url) return null;
  if (url.hostname === 'geo.dailymotion.com' && /^\/player(?:\/[A-Za-z0-9]{2,24})?\.html$/.test(url.pathname)
      && /^[A-Za-z0-9]{5,32}$/.test(url.searchParams.get('video') || '')) {
    url.hash = '';
    return url.href;
  }
  const id = url.hostname === 'dai.ly' ? url.pathname.match(/^\/([A-Za-z0-9]{5,32})\/?$/)?.[1]
    : ['dailymotion.com', 'www.dailymotion.com'].includes(url.hostname)
      ? url.pathname.match(/^\/(?:embed\/)?video\/([A-Za-z0-9]{5,32})(?:_[^/]*)?\/?$/)?.[1] : null;
  return id ? `https://www.dailymotion.com/embed/video/${id}` : null;
}

export function vidaraCode(address) {
  const url = httpsUrl(address);
  if (!url || !/^(?:www\.)?vidara\.(?:to|so)$/.test(url.hostname)) return null;
  return url.pathname.match(/^\/(?:v\/|e\/)?([A-Za-z0-9]{8,24})\/?$/)?.[1] || null;
}

export const vidaraVideo = code => `https://vidara.to/v/${code}`;
export function vidaraPlayback(address) {
  const code = vidaraCode(address);
  return code ? `https://calamarmenciano.com/calamar-vidara.php?code=${code}&hls=1` : null;
}
