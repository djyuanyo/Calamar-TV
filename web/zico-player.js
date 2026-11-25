import { premiumZicoIframe, ZICO_EMBED_ORIGIN } from './zico-channel.js';

const fragment = location.hash.slice(1);
const match = /^(premium\/)?([1-9][0-9]{0,15})(?:\?([^#]*))?$/.exec(fragment);

function showPlayer(address, publicPlayer) {
  const frame = document.createElement('iframe');
  frame.title = 'Reproductor de ZicoTV';
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'origin';
  if (publicPlayer) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
  frame.src = address;
  frame.addEventListener('load', () => frame.focus(), { once: true });
  document.body.replaceChildren(frame);
}

async function openPremium(channel, query) {
  const page = new URL(`https://bp.zicotv.cc/api/player/${channel}`);
  const params = new URLSearchParams(query);
  const eventId = params.get('event') || '';
  const proof = params.get('ct_sig') || '';
  const proofEvent = params.get('ct_event') || '';
  if (/^\d{1,16}$/.test(proofEvent) && /^[a-f0-9]{32}$/.test(proof)) {
    page.searchParams.set('ct_event', proofEvent);
    page.searchParams.set('ct_sig', proof);
  } else if (params.has('st')) page.searchParams.set('st', params.get('st'));
  const event = /^\d{1,16}$/.test(eventId) ? `https://bp.zicotv.cc/events/${eventId}` : undefined;
  document.body.textContent = 'Abriendo el reproductor de ZicoTV…';
  try {
    const address = await premiumZicoIframe(page.href, 'https://calamarmenciano.com/calamar-player.php', {
      event, signal: AbortSignal.timeout(23000),
    });
    showPlayer(address, false);
  } catch (error) {
    const message = document.createElement('p');
    message.textContent = error.message || 'No se pudo abrir el reproductor de ZicoTV.';
    const retry = document.createElement('button');
    retry.textContent = 'Reintentar';
    retry.addEventListener('click', () => openPremium(channel, query), { once: true });
    document.body.replaceChildren(message, retry);
  }
}

if (!match) document.body.textContent = 'El enlace de este canal de ZicoTV no es válido.';
else if (match[1]) void openPremium(match[2], match[3]);
else showPlayer(`${ZICO_EMBED_ORIGIN}/api/player/${match[2]}`, true);
