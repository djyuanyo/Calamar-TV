import test from 'node:test';
import assert from 'node:assert/strict';
import { folderReference, driveFolder, scanFolders, DRIVE_ENDPOINT } from '../web/library-folders.js';
import { libraryFromScan } from '../web/library-lulu.js';
import { webPlayback } from '../web/catalog.js';

const key = 'AIza' + 'x'.repeat(35);
const video = id => `https://calamarmenciano.com/calamar-drive.php?id=${id}&v=${'A'.repeat(80)}`;
const json = (data,status=200)=>({ok:status===200,status,json:async()=>data});

test('only actual Drive and LuluStream folder links are accepted, including resource keys',()=>{
  assert.deepEqual(folderReference('https://drive.google.com/drive/u/1/folders/abc_DEF?resourcekey=r_key'),{provider:'drive',id:'abc_DEF',resourceKey:'r_key'});
  assert.deepEqual(folderReference('https://luluvido.com/fld/abc123/Series'),{provider:'lulu',code:'abc123'});
  for(const url of ['https://evil.com/drive/folders/abc','http://drive.google.com/drive/folders/abc','https://x@drive.google.com/drive/folders/abc','https://drive.google.com/file/d/abc/view','https://luluvido.com/video123456']) assert.throws(()=>folderReference(url));
});

test('Drive pagination preserves every page and sends credentials only in the POST body',async()=>{
  const calls=[];
  const folder=await driveFolder({id:'root',resourceKey:'resource'},key,async(url,options)=>{
    calls.push([url,options]);
    return json(options.body.get('pageToken')?{name:'Películas',files:[{title:'Dos.mp4',link:video('dos')}]}:{name:'Películas',files:[{title:'Uno.mp4',link:video('uno')}],nextPageToken:'page2'});
  });
  assert.equal(folder.files.length,2);
  assert.deepEqual(calls.map(([url])=>url),[DRIVE_ENDPOINT,DRIVE_ENDPOINT]);
  assert.equal(calls[1][1].body.get('pageToken'),'page2');
  assert.equal(calls[0][1].body.get('key'),key);
  await assert.rejects(driveFolder({id:'root'},key,async()=>json({nextPageToken:'same'})),/incompleta/);
  await assert.rejects(driveFolder({id:'root'},key,async()=>json({error:'Carpeta no compartida'},403)),/no compartida/);
});

test('one scan combines Drive films, season folders and documentaries with a LuluStream folder URL',async()=>{
  const folders={
    movies:{name:'Películas',files:[{title:'Avatar (2009).mp4',link:video('avatar')}]},
    series:{name:'Series',folders:[{id:'paco',name:'Los Hombres de Paco'}]},
    paco:{name:'Los Hombres de Paco',folders:[{id:'s2',name:'Temporada 2'}]},
    s2:{name:'Temporada 2',files:[{title:'03.mp4',link:video('paco203')}]},
    docs:{name:'Documentales',files:[{title:'Planeta (2020).mp4',link:video('planeta')}]},
  };
  const fetcher=async(url,options)=>{
    if(url===DRIVE_ENDPOINT) return json(folders[options.body.get('id')]);
    const id=new URL(url).searchParams.get('fld_id');
    return json({status:200,result:id==='0'?{folders:[{fld_id:7,name:'Más películas',code:'sharecode'}]}:{files:[{file_code:'lulufilm1234',title:'Otra (2025).mp4'}]}});
  };
  const scan=await scanFolders([{section:'movies',url:'https://drive.google.com/drive/folders/movies'},
    {section:'series',url:'https://drive.google.com/drive/folders/series'},
    {section:'documentaries',url:'https://drive.google.com/drive/folders/docs'},
    {section:'movies',url:'https://luluvido.com/fld/sharecode'}],{drive:key,lulu:'clave123456'}, {fetcher});
  assert.deepEqual(scan.films.map(f=>[f.section,f.title,f.link]),[['movies','Avatar',video('avatar')],['documentaries','Planeta',video('planeta')],['movies','Otra','https://luluvido.com/lulufilm1234']]);
  assert.deepEqual(scan.series[0].episodes.map(e=>[e.season,e.episode,e.link]),[[2,3,video('paco203')]]);
  assert.deepEqual(webPlayback(video('avatar')),{ok:true,kind:'video'});
  assert.equal(webPlayback(video('avatar').replace('calamarmenciano.com','evil.com')).ok,false);
});

test('duplicates across providers keep the current film and existing episodes while adding missing episodes',async()=>{
  const current={movies:[{id:'m1',kind:'movie',title:'Avatar',year:2009,url:'https://luluvido.com/first123456',featured:true,tmdb:{id:1,title:'Avatar',year:2009}}],
    series:[{id:'s2',kind:'tv',title:'Mi serie',folder:'Mi serie',tmdb:{id:2,title:'Mi serie'},skip:{intro:[10,30]},episodes:[{id:'e2x1x1',season:1,episode:1,url:video('old'),addedAt:'2026-01-01'}]}],documentaries:[]};
  const scan={films:[{section:'movies',title:'Avatar',year:2009,file:'Avatar.mp4',link:video('avatar')},{section:'documentaries',title:'Avatar',year:2009,file:'Avatar.mp4',link:video('another')}],series:[{section:'series',title:'Mi serie',folder:'Mi serie',episodes:[{season:1,episode:1,link:'https://luluvido.com/repeated1234'},{season:1,episode:2,link:'https://luluvido.com/new12345678'}]}],unknown:[]};
  const result=await libraryFromScan(scan,current,'tmdb',{skipDuplicates:true,fetcher:async url=>{
    assert.match(url,/\/tv\/2\/season\/1/);return json({episodes:[{episode_number:1,name:'Uno'},{episode_number:2,name:'Dos'}]});
  }});
  assert.deepEqual(result.sections.movies,current.movies);
  assert.equal(result.sections.documentaries.length,0);
  assert.deepEqual(result.sections.series[0].episodes.map(e=>[e.episode,e.url]),[[1,video('old')],[2,'https://luluvido.com/new12345678']]);
  assert.deepEqual(result.sections.series[0].skip,current.series[0].skip);
  assert.deepEqual(result.skipped,{films:2,episodes:1});
  assert.equal(result.added.episodes,1);
});

test('TMDB identity catches alternate titles, remakes remain distinct and unmatched Drive IDs do not collide',async()=>{
  const scan={films:[{section:'movies',title:'Otro título',year:2009,link:video('known'),file:'known.mp4'},
    {section:'movies',title:'Avatar',year:2026,link:video('remake'),file:'remake.mp4'},
    ...['unknown1','unknown2'].map(id=>({section:'movies',title:id,file:id+'.mp4',link:video(id)}))],series:[],unknown:[]};
  const old={id:'m1',kind:'movie',title:'Avatar',year:2009,url:'https://luluvido.com/old12345678',tmdb:{id:1,title:'Avatar',year:2009}};
  const result=await libraryFromScan(scan,{movies:[old]},'tmdb',{skipDuplicates:true,fetcher:async address=>{
    const u=new URL(address),q=u.searchParams.get('query');
    if(u.pathname.includes('/search/')) return json({results:q==='Otro título'?[{id:1,title:'Otro título',release_date:'2009-01-01'}]:q==='Avatar'?[{id:9,title:'Avatar',release_date:'2026-01-01'}]:[]});
    return json({id:9,title:'Avatar',release_date:'2026-01-01'});
  }});
  assert.equal(result.sections.movies.find(x=>x.id==='m1').url,old.url);
  assert.ok(result.sections.movies.some(x=>x.id==='m9'));
  assert.deepEqual(result.sections.movies.filter(x=>x.status==='unmatched').map(x=>x.id).sort(),['udrive_unknown1','udrive_unknown2']);
  assert.equal(result.skipped.films,1);
});

test('an identified film repeated in the other folder is not offered again; a deleted copy hands over to the other',async()=>{
  const film={id:'m5',kind:'movie',title:'El viaje',year:2020,url:video('drivecopy'),tmdb:{id:5,title:'El viaje',year:2020}};
  const pending={id:'ulul0000pend',kind:'movie',title:'The Trip',year:2020,file:'The.Trip.2020.1080p.mkv',url:'https://luluvido.com/lul0000pend',status:'unmatched'};
  const tmdb=async()=>{throw Error('TMDB must not be asked');};
  const both={films:[{section:'movies',title:'The Trip',year:2020,file:'The.Trip.2020.1080p.mkv',link:video('drivecopy')},
    {section:'movies',title:'The Trip',year:2020,file:'The.Trip.2020.1080p.mkv',link:'https://luluvido.com/lul0000pend'}],series:[],unknown:[]};
  const first=await libraryFromScan(both,{movies:[film,pending]},'tmdb',{skipDuplicates:true,fetcher:tmdb});
  assert.deepEqual(first.sections.movies,[{...film,files:['thetrip2020'],mirrors:['https://luluvido.com/lul0000pend'],fromFolder:true}]);
  assert.equal(first.added.pending,0);
  // Deleted from Drive: the LuluStream copy takes over.
  const onlyLulu={films:[both.films[1]],series:[],unknown:[],providers:['drive','lulu']};
  const second=await libraryFromScan(onlyLulu,first.sections,'tmdb',{skipDuplicates:true,fetcher:tmdb});
  assert.equal(second.sections.movies.length,1);
  assert.equal(second.sections.movies[0].url,'https://luluvido.com/lul0000pend');
  assert.equal(second.sections.movies[0].mirrors,undefined);
});

test('a documentaries folder of films stays films even when one name starts with a number',async()=>{
  const names=['11M (2022) [BluRay Rip][AC3 2.0 Castellano].avi','Afganistan (2025) [HDTV 1080p][Esp].mkv','Topuria Matador (2024).mp4'];
  const fetcher=async(url,options)=>json({name:'Documentales',files:names.map((title,i)=>({title,link:video('doc'+i)})),folders:[]});
  const scan=await scanFolders([{section:'documentaries',url:'https://drive.google.com/drive/folders/docs'}],{drive:'AIza'+'x'.repeat(35)},{fetcher});
  assert.deepEqual(scan.films.map(f=>[f.section,f.title,f.year]),[['documentaries','11M',2022],['documentaries','Afganistan',2025],['documentaries','Topuria Matador',2024]]);
  assert.equal(scan.series.length,0);
  // A documentary series in the same folder layout is still read as one series.
  const episodes=async()=>json({name:'Planeta',files:['Planeta 1x01.mp4','Planeta 1x02.mp4'].map((title,i)=>({title,link:video('ep'+i)})),folders:[]});
  const show=await scanFolders([{section:'documentaries',url:'https://drive.google.com/drive/folders/docs'}],{drive:'AIza'+'x'.repeat(35)},{fetcher:episodes});
  assert.deepEqual(show.series.map(s=>[s.title,s.episodes.length]),[['Planeta',2]]);
});
