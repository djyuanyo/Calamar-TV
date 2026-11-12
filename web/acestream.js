const HLS_ORIGIN = 'https://video.calamarmenciano.com';
const CONTENT_ID = /^[a-f0-9]{40}$/i;
const HLS_LINK = /^https:\/\/video\.calamarmenciano\.com\/ace-hls\/[a-f0-9]{32}\/index\.m3u8$/;

export function aceContentId(input) {
  if (!/^acestream:/i.test(input)) return null;
  const direct = /^acestream:\/\/([a-f0-9]{40})\/?(?:\?[^#]*)?$/i.exec(input);
  if (direct) return direct[1].toLowerCase();
  const query = /^acestream:(?:\/\/)?\?([^#]+)$/i.exec(input);
  const values = query ? new URLSearchParams(query[1]).getAll('content_id') : [];
  if (values.length === 1 && CONTENT_ID.test(values[0])) return values[0].toLowerCase();
  throw new Error('El enlace Ace Stream debe incluir un Content ID válido de 40 caracteres.');
}

export async function resolveAceStreams(links, getToken, request = fetch) {
  const sources = links.map(link => ({ link, id: aceContentId(link) }));
  if (!sources.some(({ id }) => id)) return [...new Set(links)];

  const token = await getToken();
  const resolved = new Map();
  for (const { id } of sources) {
    if (!id || resolved.has(id)) continue;
    let response;
    try {
      response = await request(`${HLS_ORIGIN}/ace-register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId: id }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new Error('No se pudo conectar con Ace Stream en IONOS. Vuelve a intentar guardar.');
    }
    if (response.status === 401) throw new Error('Vuelve a entrar con tu cuenta de administración de Google para guardar enlaces Ace Stream.');
    const result = await response.json().catch(() => null);
    if (!response.ok || !HLS_LINK.test(result?.url)) {
      throw new Error('IONOS no pudo preparar el enlace Ace Stream. Vuelve a intentar guardar.');
    }
    resolved.set(id, result.url);
  }
  return [...new Set(sources.map(({ id, link }) => id ? resolved.get(id) : link))];
}
