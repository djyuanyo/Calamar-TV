// Agenda de fútbol ZicoTV. No se almacenan tokens ni URLs de fuentes caducables.
const API = 'https://bp.zicotv.cc/api/v1';
const SNAPSHOT = 'data/football.json';
let events = [];
let refreshTimer = null;
let currentId = null;
let activeFrame = null;
let stopPlayback = null;

function node(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'onclick') n.addEventListener('click',v);
    else if (v !== null && v !== undefined) n.setAttribute(k,v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c);
  return n;
}
function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
  catch { return ''; }
}
function displayTime(value) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(date);
}
async function json(url, timeout = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(),timeout);
  try {
    const response = await fetch(url,{cache:'no-store',signal:ctrl.signal});
    if (!response.ok) throw new Error('HTTP '+response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function badge(team, image) {
  const url = safeUrl(image);
  if (!url) return node('span',{class:'football-initial'},(team || '?').slice(0,2).toUpperCase());
  const img = node('img',{class:'football-badge',src:url,alt:'',loading:'lazy',referrerpolicy:'no-referrer'});
  img.addEventListener('error',()=>img.replaceWith(node('span',{class:'football-initial'},(team || '?').slice(0,2).toUpperCase())));
  return img;
}
function labelStatus(status) {
  return ({live:'EN DIRECTO',scheduled:'PRÓXIMAMENTE',finished:'FINALIZADO',cancelled:'CANCELADO'})[status] || status;
}
function eventCard(event) {
  const card = node('button',{class:'football-card',type:'button',onclick:()=>openEvent(event.id)});
  card.append(
    node('span',{class:'football-league'},event.league || 'Fútbol'),
    node('span',{class:'football-teams'},
      node('span',{class:'football-team'},badge(event.home_team,event.home_team_badge),node('span',{},event.home_team || 'Local')),
      node('span',{class:'football-versus'},'VS'),
      node('span',{class:'football-team'},badge(event.away_team,event.away_team_badge),node('span',{},event.away_team || 'Visitante'))),
    node('strong',{},event.title || 'Partido de fútbol'),
    node('span',{class:'football-meta'},displayTime(event.start_time)),
    node('span',{class:'football-state '+(event.status === 'live' ? 'is-live' : '')},labelStatus(event.status)),
    node('span',{class:'football-meta'},event.has_stream ? '▶ Ver fuentes' : 'Sin emisión disponible')
  );
  return card;
}
async function getEvents() {
  try {
    const response = await json(API+'/events?sport=Soccer');
    if (!Array.isArray(response.data)) throw Error('Respuesta inválida');
    return {items:response.data, cached:false};
  } catch {
    const fallback = await json(SNAPSHOT,6000);
    if (!Array.isArray(fallback.data)) throw Error('No hay agenda disponible');
    return {items:fallback.data,cached:true};
  }
}
async function openEvent(id) {
  currentId = id;
  const root = document.querySelector('#football-view');
  if (!root) return;
  const dialog = node('section',{class:'football-watch',role:'dialog','aria-modal':'true','aria-label':'Reproductor de partido'});
  dialog.append(node('p',{},'Cargando fuentes del partido…'));
  root.append(dialog);
  async function close() {
    currentId = null;
    if (stopPlayback) {stopPlayback();stopPlayback=null;}
    if (activeFrame) {activeFrame.src='about:blank';activeFrame=null;}
    dialog.remove();
  }
  dialog.prepend(node('button',{class:'ghost',type:'button',onclick:close},'← Volver a agenda'));
  try {
    const result = await json(API+'/events/'+encodeURIComponent(id));
    if (currentId !== id || !dialog.isConnected) return;
    const event = result.data;
    if (!event || event.sport_category !== 'Soccer') throw Error('Partido no disponible');
    dialog.replaceChildren(node('button',{class:'ghost',type:'button',onclick:close},'← Volver a agenda'),
      node('h2',{},event.title || 'Partido'),
      node('p',{class:'football-meta'},(event.league || '')+' · '+displayTime(event.start_time)));
    const sources = (Array.isArray(event.sources) ? event.sources : [])
      .filter(s => s && safeUrl(s.url))
      .sort((a,b) => Number(b.source === 'own') - Number(a.source === 'own'));
    const alternatives = [];
    for (const source of sources) {
      // When ZicoTV supplies a true media URL, use our HTML5/HLS player.
      // URLs for embeds are HTML documents and must stay inside an iframe.
      for (const stream of (Array.isArray(source.streams) ? source.streams : [])) {
        if (safeUrl(stream.url) && /\.(m3u8|mp4|webm)(?:[?#]|$)/i.test(new URL(stream.url).pathname)) {
          alternatives.push({url:stream.url, name:(source.name || source.source)+' · '+stream.stream_no, kind:'media'});
        }
      }
      if (source.type === 'iframe') alternatives.push({
        url: source.url,
        name: source.source === 'own' ? (source.name || 'ZicoTV') : 'Fuente '+source.source,
        kind:'iframe'
      });
    }
    if (!alternatives.length) {
      dialog.append(node('p',{},'Este partido no tiene fuentes disponibles.'));
      return;
    }
    const playerBox=node('div',{class:'football-frame-box'});
    const chooser=node('div',{class:'football-chooser'});
    const notice=node('p',{class:'football-meta'},'Pulsa reproducir dentro del vídeo. Si una fuente no funciona, selecciona otra.');
    const link=node('a',{class:'ghost',target:'_blank',rel:'noopener noreferrer'},'Abrir fuente en otra pestaña');
    dialog.append(playerBox,chooser,notice,link);
    let localHls = null;
    function cleanup() {
      if (localHls) {localHls.destroy();localHls=null;}
      if (activeFrame) {activeFrame.src='about:blank';activeFrame=null;}
      playerBox.replaceChildren();
    }
    stopPlayback = cleanup;
    const android = navigator.userAgent.includes('CalamarTVAndroid');
    let currentSelection = -1;
    function select(i) {
      cleanup();
      currentSelection = i;
      const chosen=alternatives[i];
      link.href=safeUrl(chosen.url);
      // Native Android can inspect the provider page through the existing
      // NativePlayerActivity. No cross-origin iframe inspection is attempted on web.
      if (android && chosen.kind === 'iframe') {
        let nativeButton=chooser.querySelector('[data-native-player]');
        if (!nativeButton) {
          nativeButton=node('button',{class:'ghost',type:'button','data-native-player':'1'},'▶ Probar reproductor nativo');
          chooser.append(nativeButton);
        }
        nativeButton.onclick=()=>{location.href='calamar-tv://football-play?url='+encodeURIComponent(chosen.url)+'&title='+encodeURIComponent(event.title || 'Partido');};
        nativeButton.hidden=false;
      } else {
        const nativeButton=chooser.querySelector('[data-native-player]');
        if(nativeButton)nativeButton.hidden=true;
      }
      if (chosen.kind==='media') {
        const video=node('video',{controls:'',playsinline:'',autoplay:''});
        video.style.cssText='width:100%;height:100%;background:#000';
        playerBox.append(video);
        const url=safeUrl(chosen.url);
        if (/\.m3u8(?:[?#]|$)/i.test(new URL(url).pathname) && window.Hls && window.Hls.isSupported()) {
          localHls=new window.Hls();
          localHls.loadSource(url);
          localHls.attachMedia(video);
          localHls.on(window.Hls.Events.ERROR,(_event,data)=>{
            if(data.fatal){
              notice.textContent='La fuente directa falló. Cambiando al reproductor del proveedor…';
              const fallback=alternatives.findIndex((item,index)=>index !== i && item.kind==='iframe');
              if(fallback>=0)select(fallback);
              else notice.textContent='No se pudo reproducir. Prueba otra fuente.';
            }
          });
        } else video.src=url;
        video.onerror=()=>{
          const fallback=alternatives.findIndex((item,index)=>index !== i && item.kind==='iframe');
          if(fallback>=0)select(fallback);
          else notice.textContent='No se pudo reproducir esta fuente.';
        };
        video.play().catch(()=>{notice.textContent='Pulsa ▶ para empezar la reproducción.';});
      } else {
        const frame=node('iframe',{src:safeUrl(chosen.url),title:'Emisión de '+(event.title || 'fútbol'),allow:'autoplay; fullscreen; picture-in-picture',allowfullscreen:'',referrerpolicy:'no-referrer'});
        activeFrame=frame;
        playerBox.append(frame);
        notice.textContent='Reproductor ZicoTV integrado. Pulsa ▶ dentro del vídeo; si no carga, prueba otra fuente o ábrela aparte.';
      }
      [...chooser.children].forEach((button,j)=>button.setAttribute('aria-pressed',String(i===j)));
    }
    alternatives.forEach((s,i)=>chooser.append(node('button',{class:'ghost',type:'button',onclick:()=>select(i)},s.name)));
    select(0);
  } catch (e) {
    dialog.append(node('p',{class:'error'},'No se han podido consultar las fuentes. Inténtalo de nuevo.'));
  }
}
export async function renderFootball(view) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const root=node('section',{id:'football-view',class:'football-view'});
  view.replaceChildren(root);
  async function update() {
    if (!root.isConnected || currentId !== null) return;
    try {
      const {items,cached} = await getEvents();
      events=items.filter(e=>e && e.sport_category==='Soccer').sort((a,b)=>{
        const p={live:0,scheduled:1,finished:2,cancelled:3};
        return (p[a.status]??4)-(p[b.status]??4) || new Date(a.start_time)-new Date(b.start_time);
      });
      root.replaceChildren(node('h1',{},'Agenda de fútbol'),node('p',{class:'football-meta'},cached?'Agenda guardada en GitHub · Puede no estar actualizada':'Actualizada desde ZicoTV'));
      if (!events.length) root.append(node('p',{},'No hay partidos disponibles en el periodo publicado por la API.'));
      else root.append(node('div',{class:'football-grid'},events.map(eventCard)));
    } catch {
      root.replaceChildren(node('h1',{},'Agenda de fútbol'),node('p',{class:'error'},'No se ha podido cargar la agenda de partidos.'));
    }
  }
  await update();
  refreshTimer=setTimeout(function tick(){ if(root.isConnected){update();refreshTimer=setTimeout(tick,60000);} },60000);
}
export function leaveFootball(){if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;currentId=null;if(stopPlayback){stopPlayback();stopPlayback=null;}if(activeFrame){activeFrame.src='about:blank';activeFrame=null;}}
