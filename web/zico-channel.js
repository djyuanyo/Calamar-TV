export function zicoHost(host) {
  return host === 'zicotv.cc' || host.endsWith('.zicotv.cc');
}

/** Fixed channel and API player pages can be re-read when their video token expires. */
export function renewablePage(address) {
  try {
    const u = new URL(address);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && zicoHost(u.hostname)
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
