import { PLAYER_ENDPOINT, zicoEmbedAddress } from './catalog.js';

const status = document.getElementById('status');
try {
  const page = new URL(location.href).searchParams.get('page');
  if (!zicoEmbedAddress(page)) throw new Error('Reproductor de ZicoTV no válido.');
  const endpoint = new URL(PLAYER_ENDPOINT);
  endpoint.searchParams.set('zico_embed', page);
  const response = await fetch(endpoint, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'ZicoTV no está disponible.');
  const url = new URL(data.url);
  if (url.origin !== 'https://bp.zicotv.cc' || url.username || url.password || url.hash
      || !/^\/api\/player\/[0-9]{1,16}$/.test(url.pathname) || !url.searchParams.get('token'))
    throw new Error('La dirección del reproductor Premium no es válida.');
  const frame = document.createElement('iframe');
  frame.title = 'Reproductor Premium de ZicoTV';
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'origin';
  frame.src = url.href;
  status.replaceWith(frame);
} catch (error) {
  status.textContent = error.message || 'No se pudo abrir el reproductor de ZicoTV.';
}
