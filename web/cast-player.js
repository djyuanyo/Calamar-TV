import { needsCastBridge, prepareCastSource } from './cast-adapter.js';
/** Cast loads direct media or a server-produced H.264/AAC playlist. */
export function castSource(address) {
  try {
    const u = new URL(address);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const path = u.pathname.toLowerCase();
    const type = path.endsWith('.m3u8') ? 'application/x-mpegURL'
      : path.endsWith('.mpd') ? 'application/dash+xml'
      : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.webm') ? 'video/webm' : null;
    return type ? { url: address, type, live: /\.(m3u8|mpd)$/.test(path) } : null;
  } catch { return null; }
}

export function initCast({ button, toggle, disconnect, getSource, onSent, onStatus, onDisconnect,
  prepareSource = prepareCastSource, win = window }) {
  let context = null, controller = null, remote = null, sending = false;
  const status = (text) => onStatus?.(text);
  const update = () => {
    const connected = !!context?.getCurrentSession();
    button.hidden = !context;
    button.setAttribute('aria-pressed', String(connected));
    toggle.hidden = disconnect.hidden = !connected;
    if (connected && remote) toggle.textContent = remote.isPaused ? '▶ TV' : 'Ⅱ TV';
  };
  const send = async () => {
    const selected = getSource();
    let source = castSource(selected?.url);
    if (!source && !needsCastBridge(selected?.url)) {
      status('Esta fuente no contiene un enlace de vídeo compatible para enviar a Chromecast.');
      return;
    }
    if (!context || sending) return;
    sending = true;
    try {
      if (!context.getCurrentSession()) await context.requestSession();
      if (!source) source = await prepareSource(selected.url, { onStatus: status });
      // Do not send a channel that was closed or replaced while the device picker was open.
      if (getSource()?.url !== selected.url) return;
      const api = win.chrome.cast.media;
      const media = new api.MediaInfo(source.url, source.type);
      media.streamType = source.live ? api.StreamType.LIVE : api.StreamType.BUFFERED;
      media.metadata = new api.GenericMediaMetadata();
      media.metadata.title = selected.title || 'Calamar TV';
      if (selected.logo?.startsWith('https://')) media.metadata.images = [new win.chrome.cast.Image(selected.logo)];
      const request = new api.LoadRequest(media);
      request.autoplay = true;
      await context.getCurrentSession().loadMedia(request);
      onSent?.();
      status('Reproduciendo en Chromecast. Usa los controles TV para pausar o desconectar.');
    } catch (error) {
      const code = typeof error === 'string' ? error : error?.code;
      if (code !== 'cancel') status(error instanceof Error ? error.message : 'No se pudo enviar el vídeo a Chromecast. Comprueba el acceso del televisor al enlace.');
    } finally { sending = false; update(); }
  };
  button.addEventListener('click', send);
  toggle.addEventListener('click', () => controller?.playOrPause());
  disconnect.addEventListener('click', () => {
    context?.endCurrentSession(true);
    onDisconnect?.();
  });
  const ready = (available) => {
    if (!available || context) return;
    try {
      const framework = win.cast.framework;
      context = framework.CastContext.getInstance();
      context.setOptions({ receiverApplicationId: win.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: win.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      remote = new framework.RemotePlayer();
      controller = new framework.RemotePlayerController(remote);
      controller.addEventListener(framework.RemotePlayerEventType.IS_PAUSED_CHANGED, update);
      context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, update);
      update();
    } catch { context = null; update(); }
  };
  win.__onGCastApiAvailable = ready;
  if (win.cast?.framework && win.chrome?.cast?.isAvailable) ready(true);
  // Install the callback before loading Google's asynchronous SDK.
  const script = win.document.createElement('script');
  script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  script.async = true;
  win.document.head.append(script);
}
