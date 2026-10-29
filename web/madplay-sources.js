// MadPlay pages identify an event. Only the hosting sees or renews upstream session URLs.
export const MADPLAY_ENDPOINT = 'https://calamarmenciano.com/calamar-madplay.php';
export function madplayMatch(address) {
  try {
    const u = new URL(String(address).trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port
        || !['mpanrc4imind.my', 'madplay77.ru'].some(host => u.hostname === host || u.hostname.endsWith(`.${host}`))) return null;
    return u.pathname.match(/^\/(?:[a-z]{2}\/)?football\/[^/]+-([1-9][0-9]{0,9})\/[^/]+\.html$/)?.[1] || null;
  } catch { return null; }
}
export function madplayMenu(page) {
  const match = madplayMatch(page);
  return match ? `${MADPLAY_ENDPOINT}/match/${match}/sources.json` : null;
}
export function madplaySource(page, id) {
  const match = madplayMatch(page);
  return match && /^[1-9][0-9]{0,9}$/.test(String(id)) ? `${MADPLAY_ENDPOINT}/match/${match}/source/${id}/index.m3u8` : null;
}
export async function expandMadplaySources(entries, { fetcher = globalThis.fetch, signal } = {}) {
  const out = [];
  // One event lookup per open, even when the catalog repeats a page with a different query string.
  const menus = new Map();
  for (const input of entries) {
    const entry = typeof input === 'string' ? { url: input } : input;
    const menu = madplayMenu(entry.url);
    if (!menu) { out.push(entry); continue; }
    try {
      if (!menus.has(menu)) menus.set(menu, (async () => {
        const response = await fetcher(menu, { signal, credentials: 'omit', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : `El hosting no pudo consultar esta emisión (HTTP ${response.status}).`);
        if (!Array.isArray(data.items)) throw Error('El hosting no devolvió las fuentes del partido.');
        return data.items;
      })());
      const items = await menus.get(menu);
      const seen = new Set(); let count = 0;
      for (const item of items) {
        const url = madplaySource(entry.url, item.id);
        // Do not accept temporary upstream URLs or a menu for another event as a playable source.
        if (!url || item.url !== url || seen.has(url)) continue;
        seen.add(url); count++;
        if (!out.some(s => s.url === url)) out.push({ url, name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Señal ${count}`, origin: entry.origin || entry.url });
      }
      if (!count) throw Error('El partido no tiene fuentes habilitadas y disponibles.');
    } catch (error) {
      if (signal?.aborted) throw error;
      out.push({ ...entry, origin: entry.origin || entry.url, error: error.message || 'No se pudieron consultar las fuentes del partido.' });
    }
  }
  return out;
}
