/** Keep Dailymotion's configured, official player; its session and video URLs belong to that player. */
export function dailymotionEmbed(address) {
  try {
    const u = new URL(address);
    if (u.protocol !== 'https:' || u.hostname !== 'geo.dailymotion.com' || u.port || u.username || u.password || u.hash
      || !/^\/player\/[a-zA-Z0-9]{3,40}\.html$/.test(u.pathname)
      || !/^[a-zA-Z0-9]{3,80}$/.test(u.searchParams.get('video') || '')) return null;
    return u.href;
  } catch { return null; }
}
