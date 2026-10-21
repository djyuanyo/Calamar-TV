/** HTTP MPEG-TS and conventional IPTV URLs; the hosting validates DNS and every redirect. */
export function httpTsSource(address) {
  try {
    const u = new URL(address);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'http:' || u.username || u.password || u.hash || !/^[a-z0-9.-]+$/.test(host)
      || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
    if (/^\d+(\.\d+){3}$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    return /\.ts$/i.test(u.pathname) || /^\/(?:live\/)?[^/]+\/[^/]+\/\d+(?:\.ts)?$/i.test(u.pathname);
  } catch { return false; }
}