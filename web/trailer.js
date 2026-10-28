/** Only recognised YouTube URLs become playable trailer IDs. An explicit empty override disables it. */
export function youtubeId(value) {
  if (typeof value !== 'string') return '';
  value = value.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    const host = u.hostname.toLowerCase();
    const id = host === 'youtu.be' ? u.pathname.slice(1) : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)
      ? (u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(embed|shorts|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : '') : '';
    return /^[\w-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
export const trailerId = (item) => youtubeId(Object.hasOwn(item, 'trailerUrl') ? item.trailerUrl : item.tmdb?.trailer);
