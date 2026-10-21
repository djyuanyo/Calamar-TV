/** Catalog photos live in GitHub; the hosting holds the repository credential. */
export const IMAGE_ENDPOINT = 'https://calamarmenciano.com/calamar-images.php';
const RAW = 'https://raw.githubusercontent.com/djyuanyo/Calamar-TV/main/web/images/';
export async function imageIdentity(data) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(data);
  if (!match || data.length > 180000) throw new Error('Imagen no válida o demasiado grande.');
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  return { hash, url: `${RAW}${hash}.${match[1] === 'jpeg' ? 'jpg' : match[1]}` };
}
export async function imageRequest(body, token, fetcher = fetch) {
  let response;
  try { response = await fetcher(IMAGE_ENDPOINT, { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : {},
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000), referrerPolicy: 'no-referrer' }); }
  catch { throw new Error('No se pudo conectar con las imágenes. Sube calamar-images.php al hosting y comprueba la conexión.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Falta subir calamar-images.php al hosting.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo guardar la imagen en GitHub.');
  return result;
}
export async function externalizeImages(catalog, { known = {}, upload } = {}) {
  const data = structuredClone(catalog), cached = new Map();
  // Only image fields are migrated. Descriptions and stream addresses are preserved verbatim.
  for (const [group, fields] of [['channels', ['logo', 'cover']], ['events', ['cover']], ['teams', ['logo']], ['leagues', ['logo']]]) {
    for (const item of data[group] || []) for (const field of fields) {
      const value = item[field];
      if (typeof value !== 'string' || !value.startsWith('data:image/')) continue;
      if (!cached.has(value)) {
        const identity = await imageIdentity(value);
        // The bundled manifest lists only images already committed to this repository.
        let url = known[identity.hash] === identity.url ? identity.url : null;
        if (!url && upload) {
          const result = await upload(value);
          if (result.url !== identity.url) throw new Error('El servidor devolvió un enlace de imagen inesperado.');
          url = result.url;
        }
        cached.set(value, url || value);
      }
      item[field] = cached.get(value);
    }
  }
  return data;
}
