import { vpsIptvSource } from './http-stream.js';

const register = 'https://video.calamarmenciano.com/iptv-hls/register';
const hlsLink = /^https:\/\/video\.calamarmenciano\.com\/iptv-hls\/[a-f0-9]{32}\/index\.m3u8$/;

export async function resolveIptvStreams(links, getToken, request = fetch) {
  const unique = [...new Set(links)];
  if (!unique.some(vpsIptvSource)) return unique;

  const token = await getToken();
  const result = [];
  for (const url of unique) {
    if (!vpsIptvSource(url)) { result.push(url); continue; }
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
    result.push(data.url);
  }
  return [...new Set(result)];
}
