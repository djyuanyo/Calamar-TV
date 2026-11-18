export function zicoHost(host) {
  return host === 'zicotv.cc' || host.endsWith('.zicotv.cc');
}

/** Fixed channel and API player pages can be re-read when their video token expires. */
export function renewablePage(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' && !u.username && !u.password && zicoHost(u.hostname)
      && (/^\/api\/player\/\d+\/?$/.test(u.pathname) || !!zicoChannelPlayer(address));
  } catch { return false; }
}

/** Channel detail pages and API players share the provider's channel id. */
export function zicoChannelPlayer(address) {
  try {
    const u = new URL(address);
    const match = /^\/channels\/([0-9]{1,16})\/?$/.exec(u.pathname);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && ['zicotv.cc', 'bp.zicotv.cc'].includes(u.hostname) && match
      ? `https://bp.zicotv.cc/api/player/${match[1]}` : null;
  } catch { return null; }
}

/** Public embed or an official short-lived link, without forwarding an API token. */
export function zicoPlayerIframe(address) {
  const channel = zicoChannelPlayer(address);
  if (channel) return channel;
  try {
    const u = new URL(address);
    const player = /^\/api\/player\/([0-9]{1,16})\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !player
      || !['zicotv.cc', 'bp.zicotv.cc'].includes(u.hostname)) return null;
    const embed = new URL(`https://bp.zicotv.cc/api/player/${player[1]}`);
    const signature = u.searchParams.get('st');
    if (signature) embed.searchParams.set('st', signature);
    return embed.href;
  } catch { return null; }
}

export async function premiumZicoIframe(page, endpoint, { event, signal, fetcher = globalThis.fetch } = {}) {
  const player = zicoPlayerIframe(page);
  if (!player) throw Error('Canal de ZicoTV no válido.');
  if (new URL(player).searchParams.has('st')) return player;
  const request = new URL(endpoint);
  const originalQuery = new URL(page).search;
  const proof = /^\?ct_event=\d{1,16}&ct_sig=[a-f0-9]{32}$/.test(originalQuery) ? originalQuery : '';
  request.searchParams.set('zico_embed', player + proof);
  request.searchParams.set('zico_mode', 'token');
  if (event) request.searchParams.set('zico_event', event);
  const response = await fetcher(request.href, {
    method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
  });
  const data = await response.json().catch(() => null);
  if (data?.zicoEmbed !== 1) throw Error('El hosting no devolvió un enlace Premium de ZicoTV.');
  if (!response.ok) throw Error(data.error || 'No se pudo pedir el enlace Premium de ZicoTV.');
  const prefix = player + '?token=';
  if (data.mode !== 'token' || typeof data.url !== 'string' || !data.url.startsWith(prefix)
      || !/^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2}){16,512}$/.test(data.url.slice(prefix.length))) {
    throw Error('El hosting devolvió un enlace Premium no válido para este canal.');
  }
  return data.url;
}
