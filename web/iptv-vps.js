import { vpsIptvSource } from './http-stream.js';

const base = 'https://video.calamarmenciano.com/iptv-hls';
const register = `${base}/register`;
const hlsLink = /^https:\/\/video\.calamarmenciano\.com\/iptv-hls\/([a-f0-9]{32})\/index\.m3u8$/;
const management = 'https://calamarmenciano.com/calamar-iptv.php?iptv_admin=1';
const overflowRelay = 'https://calamarmenciano.com/calamar-tv-relay.php';
const overflowStream = `${overflowRelay}?stream=1&backup=`;

export const iptvHlsKey = link => hlsLink.exec(link)?.[1] || null;

export const isIptvOverflow = link => typeof link === 'string' && link.startsWith(overflowStream)
  && /^[a-f0-9]{32}$/.test(link.slice(overflowStream.length));

export async function iptvOverflow(link, request = fetch) {
  const key = iptvHlsKey(link);
  if (!key) return null;
  try {
    const response = await request(`${overflowRelay}?admission=${key}`, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(1400),
    });
    return response.ok && (await response.json())?.hosting === true ? overflowStream + key : null;
  } catch { return null; }
}

const bunnyPilot = 'c81ed917604c0f1a8e1a77ccac8fbb1763dab796eebf7f374ac6ab31852f3256';

/** Reuse the configured pilot without publishing the channel's playback address. */
export async function iptvPilotCdn(link) {
  const key = iptvHlsKey(link);
  if (!key || !globalThis.crypto?.subtle) return null;
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return fingerprint === bunnyPilot ? `https://calamartv.b-cdn.net/iptv-hls/${key}/index.m3u8` : null;
  } catch { return null; }
}

export async function findIptvOriginal(link, token, request = fetch) {
  const key = iptvHlsKey(link);
  if (!key || !token) return null;
  try {
    const response = await request(`${base}/original`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }), redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const { url } = await response.json();
    return vpsIptvSource(url) ? url : null;
  } catch { return null; }
}

export async function iptvManagement(action, data, token, request = fetch) {
  const response = await request(management, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Error(result?.error || 'El hosting aún no tiene habilitada la gestión IPTV.');
  return result;
}

export async function saveIptvOriginals(links, getToken, request = fetch) {
  const registered = [...new Set(links.filter(iptvHlsKey))];
  if (!registered.length) return { saved: 0, missing: 0 };
  const token = await getToken();
  let saved = 0;
  for (let i = 0; i < registered.length; i += 8) {
    const originals = {};
    await Promise.all(registered.slice(i, i + 8).map(async link => {
      const original = await findIptvOriginal(link, token, request);
      if (original) originals[iptvHlsKey(link)] = original;
    }));
    if (Object.keys(originals).length) saved += (await iptvManagement('originals', { originals }, token, request)).saved;
  }
  return { saved, missing: registered.length - saved };
}

async function registerIptvSource(url, token, request) {
  let response;
  try {
    response = await request(register, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }), redirect: 'error', signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('No se pudo conectar con el registro IPTV de IONOS. Comprueba que el VPS tenga instalada la actualización.');
  }
  if (response.status === 401) throw new Error('Vuelve a entrar con tu cuenta de administración de Google.');
  if ([404, 405].includes(response.status)) throw new Error('Falta actualizar el registro IPTV de IONOS.');
  if (response.status === 400) throw new Error('IONOS solo admite enlaces IPTV MPEG-TS públicos.');
  const data = await response.json().catch(() => null);
  if (!response.ok || !hlsLink.test(data?.url)) throw new Error('IONOS no pudo preparar el enlace IPTV. Vuelve a intentar guardar.');
  return data.url;
}

export async function prepareIptvRelays(links, getToken, request = fetch) {
  const sources = [...new Set(links.filter(vpsIptvSource))];
  if (!sources.length) return { saved: 0, missing: 0 };
  const token = await getToken();
  let saved = 0;
  let firstError;
  for (let i = 0; i < sources.length; i += 8) {
    const results = await Promise.allSettled(sources.slice(i, i + 8).map(async source => {
      const relay = await registerIptvSource(source, token, request);
      return [iptvHlsKey(relay), source];
    }));
    const originals = Object.fromEntries(results.filter(result => result.status === 'fulfilled').map(result => result.value));
    if (Object.keys(originals).length) saved += (await iptvManagement('originals', { originals }, token, request)).saved;
    firstError ??= results.find(result => result.status === 'rejected')?.reason;
  }
  if (!saved && firstError) throw firstError;
  return { saved, missing: sources.length - saved };
}

export async function resolveIptvStreams(links, getToken, request = fetch, saveOriginals = false) {
  const unique = [...new Set(links)];
  if (!unique.some(vpsIptvSource)) return unique;

  const token = await getToken();
  const result = [];
  const originals = {};
  for (const url of unique) {
    if (!vpsIptvSource(url)) { result.push(url); continue; }
    const relay = await registerIptvSource(url, token, request);
    result.push(relay);
    originals[iptvHlsKey(relay)] = url;
  }
  // Registered originals remain recoverable through the admin sync if cPanel is being updated.
  if (saveOriginals) await iptvManagement('originals', { originals }, token, request).catch(() => {});
  return [...new Set(result)];
}
