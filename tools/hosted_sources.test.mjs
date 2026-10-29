import test from 'node:test';
import assert from 'node:assert/strict';
import { expandHostedSources, hostedRequest, hostedUrl, signalName } from '../web/hosted-sources.js';
const page = 'https://zicotv.cc/api/player/6';
const ids = ['0123456789abcdef', 'fedcba9876543210'];
test('expands every signal into a named hosting choice without exposing provider names', async () => {
  const signals = await expandHostedSources([page], { fallbackName:'LaLiga', fetcher: async url => {
    assert.equal(new URL(url).hostname, 'calamarmenciano.com');
    assert.equal(new URL(url).searchParams.get('list'), '1');
    return {ok:true,json:async()=>({name:'Liga de Campeones',items:ids.map((id,i)=>({id,name:`Liga de Campeones · Señal ${i+1}`}))})};
  }});
  assert.equal(signals.length,2);
  assert.deepEqual(signals.map(s=>s.name), ['Liga de Campeones · Señal 1','Liga de Campeones · Señal 2']);
  for (let i=0;i<2;i++) {
    const u=new URL(signals[i].url);
    assert.equal(u.hostname,'calamarmenciano.com');
    assert.equal(u.searchParams.get('source_id'),ids[i]);
    assert.equal(u.searchParams.get('page'),page);
  }
  assert.equal(signalName('Zico TV · calamarmenciano.com','Canal'),'Canal');
});
test('signed media cannot escape the relay; chosen signal id stays in fresh requests',()=>{
  assert.equal(new URL(hostedRequest(page,ids[1])).searchParams.get('source_id'),ids[1]);
  assert.equal(hostedUrl('calamar-player.php?seg=a&sig=b'),'https://calamarmenciano.com/calamar-player.php?seg=a&sig=b');
  for(const url of ['https://zicotv.cc/x.m3u8','https://calamarmenciano.com.evil.test/calamar-player.php?seg=a&sig=b','/other.php?seg=a&sig=b'])assert.throws(()=>hostedUrl(url));
});
test('failed lookup stays retryable and never falls back to a direct provider stream',async()=>{
  const result=await expandHostedSources([page],{fallbackName:'Mi canal',fetcher:async()=>({ok:false,status:502})});
  assert.equal(result[0].name,'Mi canal'); assert.ok(result[0].error); assert.equal(result[0].sourceId,undefined);
});

test('the installed count-only relay also exposes every selectable hosted signal',async()=>{
  const rows=await expandHostedSources([page],{fallbackName:'LaLiga TV Bar',fetcher:async()=>({ok:true,json:async()=>({sources:5})})});
  assert.equal(rows.length,5); assert.equal(rows[4].name,'LaLiga TV Bar · Señal 5');
  assert.equal(new URL(rows[4].url).searchParams.get('src'),'4');
  assert.equal(new URL(rows[4].url).searchParams.get('cast'),'1');
});
