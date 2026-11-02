// Admission and user controls against isolated Firebase/session doubles; no live accounts or catalog.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fakeFirebase } from './browser_fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CALAMAR_PLAYWRIGHT||'playwright');
const root=resolve('web'),pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
const fixture={channels:[{id:'sport-one',name:'Sports One',group:'Deportes',streams:['https://example.com/live.mp4']}],featured:[],hidden:[],
  leagues:[{id:'league-fixture',name:'Liga de prueba'}],teams:[{id:'home',name:'Águilas',logo:pixel},{id:'away',name:'Betis',logo:pixel}],
  events:[{id:'game',name:'Águilas vs Betis',cover:pixel,leagueId:'league-fixture',homeTeamId:'home',awayTeamId:'away',channelId:'sport-one',streams:[]}]};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(fakeFirebase(fixture));return;}
  if(path==='/data/custom.json'||path==='/data/tdt.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(path.includes('custom')?fixture:{channels:[]}));return;}
  try{const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CALAMAR_CHROME_CHANNEL?{channel:process.env.CALAMAR_CHROME_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[],media=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().startsWith('https://example.com/'))media.push(r.url());});
  await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(()=>{window.__initialAuth=null;window.__initialWebAccess={requireLogin:true};window.__fakeLogin=true;});
  await page.goto(base+'/#/canal/sports-one');
  await page.getByRole('heading',{name:'Entra',exact:true}).waitFor();
  assert.equal(await page.locator('#player').isVisible(),false);assert.equal(media.length,0,'A direct link cannot load media before Firebase confirms admission');
  assert.equal(await page.locator('.nav').isVisible(),false);assert.equal(await page.getByRole('button',{name:'Google',exact:true}).locator('svg').count(),1);
  await mkdir('tools/ui-artifacts',{recursive:true});await page.screenshot({path:'tools/ui-artifacts/access-login.png'});
  await page.getByRole('button',{name:'Google',exact:true}).click();
  await page.waitForFunction(()=>window.__account?.profiles?.length>0);
  await page.locator('.profile-gate .gate-profile').first().click();
  await page.locator('#player:not([hidden])').waitFor();assert.ok(page.url().endsWith('#/canal/sports-one'),'Sign-in must retain the requested channel link');
  await page.locator('#ctl-multi').click();const picker=page.getByRole('dialog',{name:'Añadir evento',exact:true});await picker.waitFor();
  assert.equal(await picker.locator('.multi-event-choice .multi-event-art .crest').count(),2);await page.screenshot({path:'tools/ui-artifacts/event-picker-cards.png'});
  await picker.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.evaluate(()=>window.__setAuthFixture(null));await page.getByRole('heading',{name:'Entra',exact:true}).waitFor();assert.equal(await page.locator('#player').isVisible(),false);
  await page.evaluate(()=>window.__setWebAccess({requireLogin:false}));await page.locator('#player:not([hidden])').waitFor();
  await page.evaluate(()=>window.__setWebAccess({requireLogin:true}));await page.getByRole('heading',{name:'Entra',exact:true}).waitFor();
  await page.getByRole('button',{name:'Google',exact:true}).click();await page.locator('#player:not([hidden])').waitFor();
  await page.evaluate(()=>window.__setUserBlocked('member-fixture',true));await page.getByRole('heading',{name:'Acceso suspendido',exact:true}).waitFor();assert.equal(await page.locator('#player').isVisible(),false);
  await page.evaluate(()=>window.__setUserBlocked('member-fixture',false));await page.locator('#player:not([hidden])').waitFor();
  // The administrator is exempt from their own wall, can change the policy and cannot block themselves.
  await page.evaluate(()=>window.__setAuthFixture({uid:'admin-fixture',email:'admin@example.com',displayName:'Administrador'}));
  await page.evaluate(()=>{location.hash='#/admin/usuarios';});await page.getByRole('heading',{name:'Usuarios',exact:true}).waitFor();
  await page.getByLabel('Buscar usuarios').fill('alvaro');assert.equal(await page.locator('.user-card').count(),1);
  await page.getByRole('button',{name:'Bloquear en la web a Álvaro',exact:true}).click();await page.getByRole('button',{name:'Desbloquear a Álvaro',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__lastUserBlock),{uid:'member-fixture',blocked:true});
  await page.getByRole('button',{name:'Desbloquear a Álvaro',exact:true}).click();await page.getByRole('button',{name:'Bloquear en la web a Álvaro',exact:true}).waitFor();
  const admission=page.getByRole('switch',{name:'Exigir una cuenta para entrar en la web'});await admission.setChecked(false);await page.waitForFunction(()=>window.__savedWebAccess?.requireLogin===false);
  await page.getByLabel('Buscar usuarios').fill('');assert.equal(await page.getByRole('button',{name:'Bloquear en la web a Administrador'}).isEnabled(),false);
  await page.screenshot({path:'tools/ui-artifacts/users-admin.png'});assert.deepEqual(errors,[]);
  console.log('PASS: confirmed sign-in before deep-link media, guest mode, logout/revocation, Google mark, crest cards and admin-only user/policy controls');
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
