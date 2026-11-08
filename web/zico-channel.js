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
