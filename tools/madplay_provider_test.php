<?php
require __DIR__.'/../hosting/calamar-madplay.php';
function assertMad($ok,$why){if(!$ok)throw new Exception($why);}
function v($x){$s='';do{$n=$x&127;$x>>=7;$s.=chr($n|($x?128:0));}while($x);return $s;}
function field($id,$value,$integer=false){return v(($id<<3)|($integer?0:2)).($integer?v($value):v(strlen($value)).$value);}
function envelope($data){return field(3,'Success').field(10,$data);}
function streamData($id,$name,$status=1,$available=0){return field(1,$id,true).field(3,$name).field(5,$status,true).field(6,$available,true).field(9,2001,true);}
function rotEncode($text){$o='';foreach(str_split('12345678'.$text)as$c){$n=ord($c);$o.=$n>=33&&$n<=126?chr(33+($n-33+47)%94):$c;}return $o;}
$requests=[];$issuedId=905919;
$provider=new MadplayProvider(function($url)use(&$requests,&$issuedId){
    $requests[]=$url;$path=parse_url($url,PHP_URL_PATH);parse_str(parse_url($url,PHP_URL_QUERY)??'',$q);
    if($path==='/api/match/detail')$data=field(2,streamData(901559,'English')).field(2,streamData(905919,'VIX ES')).field(2,streamData(906110,'Unavailable',0)).field(2,streamData(906111,'Admin disabled',1,100));
    elseif($path==='/api/user/info')$data=field(2,'ES').field(3,'EU');
    else{$data=field(2,streamData($issuedId,'VIX ES').field(4,rotEncode('https://media.example/live/index.m3u8')));assertMad(($q['streamId']??'')==='905919','explicit source identity');}
    return ['status'=>200,'body'=>envelope($data),'headers'=>['Rb-Session'=>'synthetic-provider-session']];
});
$sources=$provider->sources(4522835);assertMad(count($sources)===2,'availability filters');echo "PASS provider availability flags are honoured\n";
$r=$provider->resolve(4522835);assertMad($r['source']===905919&&preg_match('#^https://media\.example/token-[^/]+/live/index\.m3u8$#',$r['url']),'issued session in URL');echo "PASS Spanish source and server-issued session resolved from synthetic protobuf\n";
$issuedId=901559;try{$provider->resolve(4522835,905919);throw new Exception('mismatched source accepted');}catch(MadplayPlaybackFailure $e){assertMad(strpos($e->getMessage(),'fuente seleccionada')!==false,'wrong-source error');}echo "PASS sessions from a different source are rejected\n";
$before=count($requests);try{$provider->resolve(4522835,999999);throw new Exception('unknown source accepted');}catch(MadplayPlaybackFailure $e){}assertMad(count($requests)===$before+1,'unknown source stops after availability list');echo "PASS unavailable source never reaches stream authorisation\n";
foreach(["\x00","\x52\xff","\x52\x08x"] as $bad){try{MadplayProvider::protobuf($bad);throw new Exception('invalid protobuf accepted');}catch(MadplayPlaybackFailure $e){}}echo "PASS truncated and invalid protobuf rejected\n";
foreach(['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'] as $ip)assertMad(!madplayPublicIp($ip),'nonpublic IP '.$ip);assertMad(madplayPublicIp('1.1.1.1')&&madplayPublicIp('2606:4700:4700::1111'),'public addresses');echo "PASS private, reserved and mapped addresses excluded from transport\n";
foreach(['http://apis-data10.tcpwe138stya.ru/x','https://evil.example/x','https://apis-data10.tcpwe138stya.ru.evil.example/x','https://user@apis-data10.tcpwe138stya.ru/x','https://apis-data10.tcpwe138stya.ru:444/x'] as $url)assertMad(!madplayAllowedUrl($url),'URL scope');assertMad(madplayAllowedUrl('https://fhlsport954.tm3drop33weeps.ru/index.m3u8'),'observed domain');echo "PASS transport only permits observed HTTPS origins\n";
assertMad(MadplayProvider::matchFromPage('https://jack21eo.mpanrc4imind.my/es/football/russian-cup-4436876/cska-moscow-vs-lokomotiv-moscow.html?icg=RVM')===4436876,'current requested CSKA match');
assertMad(MadplayProvider::matchFromPage('https://jack21eo.mpanrc4imind.my/es/football/fifa-u17-womens-world-cup-4522835/china-u17-women-vs-france-u17-women.html?icg=RVM')===4522835,'previous match remains distinct');
assertMad(MadplayProvider::matchFromPage('https://mpanrc4imind.my.evil.example/es/football/cup-4436876/match.html')===null,'lookalike host rejected');
echo "PASS page identity keeps the new CSKA match separate from the finished match\n";
$menu=madplayMenuItems(4436876,[['id'=>905919,'name'=>'VIX ES'],['id'=>901559,'name'=>'English'],['id'=>905919,'name'=>'Duplicate']], [905919]);
assertMad(count($menu)===1&&$menu[0]['url']==='https://calamarmenciano.com/calamar-madplay.php/match/4436876/source/905919/index.m3u8','menu must stay within match and configured sources');
echo "PASS public menu only exposes configured stable sources of its match\n";
echo "9 offline provider tests passed; no real API or media requested.\n";
