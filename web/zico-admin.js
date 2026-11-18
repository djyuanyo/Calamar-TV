const ZICO_ADMIN_ENDPOINT = 'https://video.calamarmenciano.com/calamar-zico-admin.php';

async function zicoConfig(body, idToken) {
  const headers = { Authorization: 'Bearer ' + idToken };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(ZICO_ADMIN_ENDPOINT, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', headers,
    redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (result?.zicoConfig !== 1) throw Error('No se pudo acceder a la configuración de ZicoTV en IONOS.');
  if (!response.ok) throw Error(result.error || 'No se pudo guardar el token de ZicoTV.');
  return result;
}

export const zicoTokenStatus = (idToken) => zicoConfig(null, idToken);
export const saveZicoToken = (token, idToken) => zicoConfig({ token }, idToken);
