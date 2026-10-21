import test from 'node:test';
import assert from 'node:assert/strict';
import { externalizeImages, imageIdentity, imageRequest } from '../web/github-images.js';
import { validateCatalog } from '../web/shared-catalog.js';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const catalog = () => ({ channels: [{id:'one',name:'Uno',streams:['http://iptv.example/u/p/1']}], featured:[], hidden:[],
  events:[{id:'event',name:'Partido',channelId:'one',cover:photo}], leagues:[{id:'league',name:'Liga',logo:photo}], teams:[] });
test('identical existing covers migrate without uploads; catalog and stream bytes are preserved',async()=>{
  const original=catalog(),identity=await imageIdentity(photo);let called=0;
  const result=await externalizeImages(original,{known:{[identity.hash]:identity.url},upload:()=>{called++;}});
  assert.equal(called,0);assert.equal(result.events[0].cover,identity.url);assert.equal(result.leagues[0].logo,identity.url);
  assert.equal(original.events[0].cover,photo);assert.equal(result.channels[0].streams[0],original.channels[0].streams[0]);validateCatalog(result);
});
test('new pictures upload once, returned paths must match their content hash',async()=>{
  const identity=await imageIdentity(photo);let called=0;
  const result=await externalizeImages(catalog(),{upload:async p=>{assert.equal(p,photo);called++;return {url:identity.url};}});
  assert.equal(called,1);assert.equal(result.events[0].cover,identity.url);
  await assert.rejects(externalizeImages(catalog(),{upload:async()=>({url:'https://other.example/photo.jpg'})}),/inesperado/);
  await assert.rejects(externalizeImages(catalog(),{upload:async()=>{throw Error('Hosting sin configurar');}}),/Hosting sin configurar/);
});
test('existing inline images remain visible before an image has been migrated',async()=>{
  assert.equal((await externalizeImages(catalog())).events[0].cover,photo);
  await assert.rejects(imageIdentity('data:text/html;base64,PHNjcmlwdD4='),/no válida/);
});
test('catalog size is checked after photos are externalized, retaining the final limit',async()=>{
  const large=catalog();large.events=[];
  const data='data:image/jpeg;base64,'+'YWFh'.repeat(30000);
  for(let i=0;i<5;i++)large.events.push({id:'e'+i,name:'Evento',channelId:'one',cover:data});
  assert.throws(()=>validateCatalog(large),/tamaño/);validateCatalog(large,{checkSize:false});
  const moved=await externalizeImages(large,{upload:async p=>({url:(await imageIdentity(p)).url})});
  validateCatalog(moved);assert.ok(JSON.stringify(moved).length<5000);
});
test('Firebase authorization goes only to the HTTPS hosting; no repository credential is needed to upload',async()=>{
  let request;
  const result=await imageRequest({action:'upload',image:photo},'firebase-id-token',async(url,options)=>{
    request={url,options};return {ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({url:'https://example.com/photo.jpg'})};
  });
  assert.equal(request.url,'https://calamarmenciano.com/calamar-images.php');
  assert.equal(request.options.headers.Authorization,'Bearer firebase-id-token');
  assert.equal(new URL(request.url).search,'');assert.equal(JSON.parse(request.options.body).image,photo);assert.ok(result.url);
});
