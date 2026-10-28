import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('trailer starts with sound, no YouTube controls, reports remaining time and offers a blocked-start button', async () => {
 const html=await readFile(new URL('../web/trailer.html',import.meta.url),'utf8');
 const elements=Object.fromEntries(['start','progress','remaining'].map(k=>[k,{}]));
 const classes=new Set(); let config, interval, muted=true, volume=0, playing=false;
 const api={unMute(){muted=false},setVolume(v){volume=v},playVideo(){playing=true},pauseVideo(){playing=false},getDuration:()=>90,getCurrentTime:()=>35};
 const context={URLSearchParams,location:{search:'?v=abcdefghijk',origin:'https://example.com'},document:{getElementById:k=>elements[k],body:{classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n))}},addEventListener(){}},setInterval:f=>(interval=f,1),clearInterval(){interval=null},YT:{Player:class{constructor(_,c){config=c;return api}}}};
 context.window=context;context.parent=context;context.addEventListener=()=>{};
 vm.createContext(context);vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
 context.onYouTubeIframeAPIReady();assert.equal(config.playerVars.controls,0);assert.equal(config.playerVars.mute,undefined);
 config.events.onReady({target:api});assert.equal(muted,false);assert.equal(volume,100);assert.equal(playing,true);
 config.events.onStateChange({data:1});assert.equal(elements.remaining.textContent,'-0:55');assert.equal(elements.progress.value,35);assert.ok(interval);
 config.events.onAutoplayBlocked();assert.ok(classes.has('blocked'));elements.start.onclick();assert.equal(playing,true);
 context.pauseTrailer();assert.equal(playing,false);assert.equal(interval,null);
 config.events.onError();assert.equal(classes.has('playing'),false);assert.equal(classes.has('blocked'),false);
});
