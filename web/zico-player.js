const channel = location.hash.slice(1);
if (/^[1-9][0-9]{0,15}$/.test(channel)) {
  const frame = document.createElement('iframe');
  frame.title = 'Reproductor de ZicoTV';
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
  frame.src = 'https://zicotv.gcorecdn.com/api/player/' + channel;
  frame.addEventListener('load', () => frame.focus(), { once: true });
  document.body.append(frame);
} else {
  document.body.textContent = 'El enlace de este canal de ZicoTV no es válido.';
}
