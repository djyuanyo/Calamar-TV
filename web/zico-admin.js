import { PLAYER_ENDPOINT } from './catalog.js';

async function zicoConfig(body, idToken) {
  const response = await fetch(PLAYER_ENDPOINT + '?zico_config=1', {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000),
    ...(body ? { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (result?.zicoConfig !== 1) throw Error('Actualiza calamar-player.php en el hosting para poder guardar el token.');
  if (!response.ok) throw Error(result.error || 'No se pudo guardar el token de ZicoTV.');
  return result;
}

export const zicoTokenStatus = () => zicoConfig();
export const saveZicoToken = (token, idToken) => zicoConfig({ token }, idToken);
