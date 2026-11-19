import { playerEndpoint } from './catalog.js';

/** Keep the decoder and its buffer; renew only the URLs used by subsequent playlist requests. */
export function mediaOrigin(address) {
  try {
    const u = new URL(address);
    if (!playerEndpoint(address)) return u;
    const seg = u.searchParams.get('seg');
    if (!seg || !u.searchParams.get('sig')) return null;
    const code = seg.replaceAll('-', '+').replaceAll('_', '/');
    return new URL(atob(code.padEnd(Math.ceil(code.length / 4) * 4, '=')));
  } catch { return null; }
}

function identity(address) {
  try {
    const owned = playerEndpoint(address), u = mediaOrigin(address);
    if (u && u.protocol === 'https:' && !u.username && !u.password) {
      for (const key of ['token','e','expires']) u.searchParams.delete(key);
      u.hash = '';
      return `${owned ? 'hosted:' : 'direct:'}${u.href}`;
    }
    // Compatibility with relays using opaque stream ids; never cross the owned endpoint boundary.
    if (owned) {
      const relay = new URL(address);
      if (!relay.searchParams.has('seg') || !relay.searchParams.has('sig')) return null;
      relay.searchParams.delete('sig');
      return `opaque:${relay.pathname}?${relay.searchParams}`;
    }
  } catch { /* Invalid source. */ }
  return null;
}

export function hlsContinuity(initial) {
  const root = identity(initial), owned = !!playerEndpoint(initial);
  let urls = new Map();
  return {
    resolve(address) { return urls.get(identity(address)) || address; },
    update(fresh, text) {
      if (!root || identity(fresh) !== root || !/^#EXTM3U\s/m.test(text) || !/^#(?:EXTINF:|EXT-X-STREAM-INF:)/m.test(text)) return false;
      const next = new Map([[root, fresh]]);
      const add = ref => {
        try {
          const address = new URL(ref, fresh).href, upstream = mediaOrigin(address);
          if (owned !== !!playerEndpoint(address)) return;
          if (!owned && new URL(address).origin !== new URL(fresh).origin) return;
          if (!upstream || !/\.m3u8$/i.test(upstream.pathname)) return;
          const key = identity(address);
          if (key) next.set(key, address);
        } catch { /* Malformed playlist reference. */ }
      };
      for (const line of text.split(/\r?\n/)) {
        const value = line.trim();
        if (value && !value.startsWith('#')) add(value);
        if (/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/.test(value)) {
          const ref = /\bURI="([^"]+)"/.exec(value); if (ref) add(ref[1]);
        }
      }
      urls = next;
      return true;
    },
  };
}
