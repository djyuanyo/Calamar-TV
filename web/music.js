// Calamar TV Música — catalogue supplied by Audius, not Spotify.
const API = 'https://api.audius.co/v1';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storeKey = uid => 'calamar_music_saved_v1_' + (uid || 'guest');
function readSaved(uid) { try { return JSON.parse(localStorage.getItem(storeKey(uid))) || []; } catch { return []; } }
function save(uid, tracks) { try { localStorage.setItem(storeKey(uid), JSON.stringify(tracks)); } catch {} }
function trackModel(t) { return {id:t.id, title:t.title, artist:t.user?.name || 'Artista', artwork:t.artwork?.['480x480'] || t.artwork?.['150x150'] || '', duration:t.duration}; }
const css = `
.music-root{color:#f8fafc;background:linear-gradient(150deg,#18392e 0,#111716 260px,#101113 480px);border-radius:18px;padding:24px;min-height:72vh;font-family:system-ui,sans-serif}
.music-root *{box-sizing:border-box}.music-hero{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
.music-kicker{color:#8be2b2;font-weight:800;letter-spacing:.15em;text-transform:uppercase;font-size:12px}
.music-root h1{font-size:clamp(30px,5vw,52px);margin:4px 0}.music-root h2{font-size:23px;margin:30px 0 16px}
.music-root p{color:#a8b5ae}.music-search{background:#242a28;border:1px solid #56635a;border-radius:30px;color:#fff;padding:14px 18px;width:min(100%,410px);font-size:16px}
.music-search:focus{outline:2px solid #1ed760}.music-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:16px}
.music-tile{background:#1b201e;border:0;border-radius:10px;padding:12px;text-align:left;color:#fff;cursor:pointer;transition:background .2s}
.music-tile:hover,.music-tile:focus-visible{background:#293830}.music-tile img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#28372d}
.music-tile strong{display:block;margin-top:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.music-tile small{color:#a4aca7;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.music-tile .music-fav{border:1px solid #526054;background:transparent;color:#e9f5e9;border-radius:20px;padding:5px 10px;margin-top:10px;cursor:pointer}
.music-controls{position:sticky;bottom:6px;margin-top:32px;background:#202823;border:1px solid #405548;border-radius:12px;padding:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;box-shadow:0 8px 25px #0009}
.music-controls img{width:52px;height:52px;object-fit:cover;border-radius:6px}.music-controls button{border:none;border-radius:22px;padding:9px 18px;background:#1ed760;color:#101b13;font-weight:800;cursor:pointer}
.music-controls audio{flex:1;min-width:180px;max-width:460px}.music-note{font-size:13px}
@media(max-width:600px){.music-root{padding:16px}.music-tiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.music-controls{bottom:0}}
`;
let styleSet = false;
export function renderMusic(host, user) {
  if (!styleSet) { const s=document.createElement('style'); s.textContent=css; document.head.append(s); styleSet=true; }
  const uid = user?.uid || null;
  let saved = readSaved(uid), active = null, tracks = [], disposed=false;
  host.innerHTML = `<section class="music-root"><div class="music-hero"><div><div class="music-kicker">Calamar TV · Música</div><h1>Tu música, tu ritmo.</h1><p>Explora música independiente y crea tu propia biblioteca.</p></div><label><span class="sr">Buscar canciones o artistas</span><input class="music-search" type="search" placeholder="Buscar canciones o artistas…" aria-label="Buscar música"></label></div><h2 id="music-heading">Descubre música</h2><div class="music-tiles" id="music-results"></div><h2>Mi biblioteca <small id="music-count"></small></h2><p class="music-note">Los favoritos se guardan en este dispositivo por cuenta. La sincronización en la nube estará disponible después.</p><div class="music-tiles" id="music-saved"></div><div class="music-controls" hidden><img alt="" id="music-cover"><div><strong id="music-playing"></strong><div id="music-artist"></div></div><audio controls preload="none" id="music-audio"></audio></div><p class="music-note">Catálogo de Audius. Algunas pistas pueden no estar disponibles para reproducción en tu región o navegador.</p></section>`;
  const $ = s => host.querySelector(s);
  const results=$('#music-results'), favorites=$('#music-saved'), audio=$('#music-audio');
  const controls=$('.music-controls');
  function play(t) {
    active=t; controls.hidden=false;
    $('#music-cover').src=t.artwork || ''; $('#music-playing').textContent=t.title; $('#music-artist').textContent=t.artist;
    audio.src=`${API}/tracks/${encodeURIComponent(t.id)}/stream?app_name=CalamarTV`;
    audio.play().catch(()=>{}); // Browser autoplay policies may require another tap.
  }
  function cards(dest, entries) {
    dest.replaceChildren();
    entries.forEach(t=>{
      const card=document.createElement('div');card.className='music-tile';
      card.innerHTML=`<button class="music-tile" type="button" style="width:100%" aria-label="Reproducir ${esc(t.title)}">${t.artwork?`<img alt="" loading="lazy" src="${esc(t.artwork)}">`:'<div style="aspect-ratio:1"></div>'}<strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></button><button type="button" class="music-fav">${saved.some(f=>f.id===t.id)?'♥ Guardada':'♡ Guardar'}</button>`;
      card.firstElementChild.addEventListener('click',()=>play(t));
      card.lastElementChild.addEventListener('click',()=>{saved=saved.some(f=>f.id===t.id)?saved.filter(f=>f.id!==t.id):[...saved,t];save(uid,saved);cards(favorites,saved);cards(results,tracks);$('#music-count').textContent='('+saved.length+')';});
      dest.append(card);
    });
  }
  function redraw(){cards(favorites,saved);$('#music-count').textContent='('+saved.length+')';if(!saved.length)favorites.textContent='Aún no has guardado canciones.';}
  redraw();
  let seq=0;
  async function search(query){
    const n=++seq;results.textContent='Buscando música…';
    try {
      const url=`${API}/tracks/search?query=${encodeURIComponent(query)}&limit=24&app_name=CalamarTV`;
      const response=await fetch(url);if(!response.ok)throw Error('API unavailable');
      const json=await response.json();if(disposed||n!==seq)return;
      tracks=(Array.isArray(json.data)?json.data:[]).map(trackModel).filter(t=>t.id);
      cards(results,tracks);if(!tracks.length)results.textContent='No se encontraron canciones.';
    } catch {if(!disposed&&n===seq)results.textContent='No se pudo conectar con el catálogo de Audius. Inténtalo de nuevo.';}
  }
  let debounce;
  $('.music-search').addEventListener('input',e=>{clearTimeout(debounce);$('#music-heading').textContent=e.target.value.trim()?'Resultados':'Descubre música';debounce=setTimeout(()=>search(e.target.value.trim()||'electronic'),350);});
  search('electronic');
  // Do not leave background audio playing when navigating out of the section.
  return () => {disposed=true;clearTimeout(debounce);audio.pause();audio.removeAttribute('src');audio.load();};
}
