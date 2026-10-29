<?php
require __DIR__ . '/../hosting/calamar-madplay-session.php';
function check($ok, $message) { if (!$ok) throw new Exception($message); }
function fixture($name) { return file_get_contents(__DIR__ . '/fixtures/madplay/' . $name . '.m3u8'); }
function response($body, $status=200, $headers=[]) { return ['status'=>$status, 'body'=>$body, 'headers'=>$headers]; }
function context($resolver=null, $fetcher=null) {
    $c = (object)['state'=>[], 'time'=>1000, 'resolves'=>0, 'requests'=>[], 'offered'=>[]];
    $c->session = new MadplaySession(4522835, 905919, $c->state, function ($match,$source,$offered) use ($c,$resolver) {
        $c->resolves++; $c->offered[]=$offered;
        return $resolver ? $resolver($c) : ['url'=>'https://media.example/session-'.$c->resolves.'/index.m3u8'];
    }, function ($url) use ($c,$fetcher) { $c->requests[]=$url; return $fetcher ? $fetcher($url,$c) : response(fixture('live-old')); }, function () use ($c) { return $c->time; }, 'test-only-local-signing-key');
    return $c;
}
function asset($list,$line=0) { preg_match_all('#asset/([a-f0-9]{32})\.(?:bin|m3u8)#', $list, $m); return $m[1][$line]; }
$tests=[];
$tests['stable identity and cached credentials until renewal interval'] = function () {
    $c=context(); $a=$c->session->playlist(); $c->time+=30; $b=$c->session->playlist(); check($a===$b && $c->resolves===1,'reused session');
    $c->time+=31; $c->session->playlist(); check($c->resolves===2,'renewed before stale credentials persist');
};
$tests['expired segment obtains new session and new segment signature'] = function () {
    $c=context(null,function($url) { return substr($url,-5)==='.m3u8' ? response(strpos($url,'session-2')!==false?fixture('live-renewed'):fixture('live-old')) : (strpos($url,'token=old')!==false?response('',401):response(str_repeat(chr(71),564))); });
    $list=$c->session->playlist();$c->time+=6; $r=$c->session->segment(asset($list,1));check($r['status']===200&&$c->resolves===2,'renewed');check(strpos(end($c->requests),'101.json?token=new')!==false,'uses the renewed signature for the SAME segment');
};
$tests['provider-issued session recovery is honoured once'] = function () {
    $c=context(null,function($url) { return substr($url,-5)==='.m3u8'?response(strpos($url,'session-2')!==false?fixture('live-renewed'):fixture('live-old')):(strpos($url,'token=old')!==false?response('',403,['Rb-Session'=>'provider-issued-replacement']):response('video')); });
    $list=$c->session->playlist();$c->time+=6;$c->session->segment(asset($list,1));check($c->offered[1]==='provider-issued-replacement','provider session passed to resolver');
};
$tests['bare 403 is a blocked download, never a token-renewal loop'] = function () {
    $c=context(null,function($url) { return substr($url,-5)==='.m3u8'?response(fixture('live-old')):response('Forbidden',403); });
    $list=$c->session->playlist();$c->time+=6;try{$c->session->segment(asset($list));throw new Exception('must fail');}catch(MadplayPlaybackFailure $e){check($e->upstreamStatus===403,'concrete block');}check($c->resolves===1&&count($c->requests)===2,'no refresh loop for an access denial');
};
$tests['aged-out fragment is not silently replaced by a different video segment'] = function () {
    $c=context(null,function($url) { return substr($url,-5)==='.m3u8'?response(strpos($url,'session-2')!==false?fixture('live-renewed'):fixture('live-old')):response('',401); });
    $list=$c->session->playlist();$c->time+=6;try{$c->session->segment(asset($list,0));throw new Exception('must fail');}catch(MadplayPlaybackFailure $e){check($e->upstreamStatus===410,'expired timeline entry');}check(count($c->requests)===3,'no invented fragment');
};
$tests['persistent expired tokens retry only once and respect a shared cooldown'] = function () {
    $c=context(null,function(){return response('',401);});try{$c->session->playlist();}catch(MadplayPlaybackFailure $e){}check($c->resolves===1,'no immediate API storm');$c->time+=6;try{$c->session->playlist();}catch(MadplayPlaybackFailure $e){}check($c->resolves===2&&count($c->requests)===3,'one renewal and bounded requests');
};
$tests['master audio/subtitle playlists, keys and relative resources remain proxied'] = function () {
    $master="#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio/es.m3u8\"\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI=\"subs/es.m3u8\"\nvideo/hd.m3u8\n";
    $c=context(null,function($url)use($master){return strpos($url,'audio/es')!==false?response("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key.bin\"\npart.aac\n"):response($master);});
    $list=$c->session->playlist();$child=$c->session->playlist(asset($list));check(strpos($child,'https://')===false&&strpos($child,'URI="/calamar-madplay.php/')!==false,'nested assets proxied');check(count($c->state['assets'])===5,'audio, subtitle, video, key and audio segment retained');
};
$tests['HTML errors with HTTP 200 never pass as working video'] = function () {
    $c=context(null,function(){return response('<html><h1>Site Unavailable</h1></html>');});try{$c->session->playlist();throw new Exception('must fail');}catch(MadplayPlaybackFailure $e){check(strpos($e->getMessage(),'página')!==false,'actual content checked');}
};
$tests['URI resolution and unknown resources reject invalid requests'] = function () {
    check(MadplaySession::resolveUrl('https://media.example/a/b/index.m3u8','../s.ts?q=1')==='https://media.example/a/s.ts?q=1','relative parent');$c=context();try{$c->session->segment(str_repeat('0',32));throw new Exception('must fail');}catch(MadplayPlaybackFailure $e){check($e->upstreamStatus===404,'unknown resource');}check(!$c->requests,'no network on invented asset');
};
$tests['proactive renewal rehydrates a secondary playlist before requesting it'] = function () {
    $c=context(null,function($url){if(strpos($url,'es.m3u8')!==false)return response("#EXTM3U\npart.aac?token=new\n");return response("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio/es.m3u8?token=".(strpos($url,'session-2')!==false?'new':'old')."\"\n");});
    $list=$c->session->playlist();$id=asset($list);$c->time+=61;$c->session->playlist($id);
    check($c->resolves===2&&strpos(end($c->requests),'es.m3u8?token=new')!==false,'child playlist credential renewed before its request');
};
$tests['proactive renewal detects an aged-out fragment even if the API returns the same root URL'] = function () {
    $c=context(function(){return ['url'=>'https://media.example/index.m3u8'];},function($url,$c){return response($c->resolves>1?fixture('live-renewed'):fixture('live-old'));});
    $list=$c->session->playlist();$c->time+=61;try{$c->session->segment(asset($list,0));throw new Exception('must fail');}catch(MadplayPlaybackFailure $e){check($e->upstreamStatus===410,'generation checked independently of token URL');}check(count($c->requests)===2,'no request for a stale segment');
};
$tests['distinct track queries are not confused when credential query values rotate'] = function () {
    $c=context(null,function(){return response("#EXTM3U\nplaylist.m3u8?audio=es&token=old\nplaylist.m3u8?audio=en&token=old\n");});$list=$c->session->playlist();check(asset($list,0)!==asset($list,1),'audio query remains part of resource identity');
};
foreach($tests as $name=>$test){$test();echo "PASS $name\n";}
echo count($tests)." offline renewal tests passed; live provider playback is NOT verified.\n";
