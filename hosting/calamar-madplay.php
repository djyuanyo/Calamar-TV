<?php
// Draft endpoint. Disabled unless an administrator enables and scopes it after live validation.
require_once __DIR__.'/calamar-madplay-provider.php';
function madplayAnswer($body,$status=200) { http_response_code($status);header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');echo json_encode($body,JSON_UNESCAPED_UNICODE);exit; }
function madplayAllowedUrl($url) {
    $p=parse_url($url);$host=strtolower($p['host']??'');
    if (($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port'])) return false;
    foreach(['apis-data-defra10.tcpwe138stya.ru','apis-data10.tcpwe138stya.ru','tm3drop33weeps.ru','pcn9203csvs3.xyz'] as $domain) if($host===$domain||substr($host,-strlen('.'.$domain))==='.' . $domain)return true;
    return false;
}
function madplayPublicIp($ip) {
    if (!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) return false;
    if (strpos($ip,':')!==false) return preg_match('/^[23][0-9a-f]{3}:/i',$ip) && !preg_match('/^(?:2001:(?:0{1,4}|db8):|2002:)/i',$ip);
    $value=ip2long($ip);
    foreach (['0.0.0.0/8','100.64.0.0/10','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24'] as $cidr) {
        [$network,$bits]=explode('/',$cidr);$mask=-1 << (32-(int)$bits);if (($value&$mask)===(ip2long($network)&$mask))return false;
    }
    return true;
}
/** Pin a public DNS result for every redirect; upstream data cannot request the hosting's own network. */
function madplayHttp($url,$range=null) {
    for($hop=0;$hop<5;$hop++) {
        if(!madplayAllowedUrl($url))throw new MadplayPlaybackFailure('El proveedor devolvió un servidor no reconocido.');
        $host=parse_url($url,PHP_URL_HOST);$records=dns_get_record($host,DNS_A|DNS_AAAA);$ips=[];
        foreach($records?:[] as $record) { $ip=$record['ip']??($record['ipv6']??'');if($ip && madplayPublicIp($ip))$ips[]=$ip; }
        if(!$ips)throw new MadplayPlaybackFailure('El servidor de vídeo no tiene una dirección pública.');
        $ip=$ips[0];$headers=[];$body='';$request=['Referer: https://jack21eo.mpanrc4imind.my/','Origin: https://jack21eo.mpanrc4imind.my'];
        if($range!==null) { if(!preg_match('/^bytes=[0-9]+-[0-9]*$/',$range))throw new MadplayPlaybackFailure('Rango no permitido.',416);$request[]='Range: '.$range; }
        $c=curl_init($url);
        curl_setopt_array($c,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_ENCODING=>'',CURLOPT_USERAGENT=>'Mozilla/5.0',CURLOPT_RESOLVE=>[$host.':443:'.(strpos($ip,':')!==false?'['.$ip.']':$ip)],CURLOPT_HTTPHEADER=>$request,CURLOPT_HEADERFUNCTION=>function($c,$line)use(&$headers){$at=strpos($line,':');if($at!==false)$headers[strtolower(trim(substr($line,0,$at)))]=trim(substr($line,$at+1));return strlen($line);},CURLOPT_WRITEFUNCTION=>function($c,$data)use(&$body){if(strlen($body)+strlen($data)>8388608)return 0;$body.=$data;return strlen($data);}]);
        $ok=curl_exec($c);$status=curl_getinfo($c,CURLINFO_RESPONSE_CODE);curl_close($c);
        if($ok===false)throw new MadplayPlaybackFailure('No se pudo descargar el recurso del servidor de vídeo.');
        if(in_array($status,[301,302,303,307,308],true)&&isset($headers['location'])) { $url=MadplaySession::resolveUrl($url,$headers['location']);continue; }
        return ['status'=>$status,'body'=>$body,'headers'=>$headers,'url'=>$url];
    }
    throw new MadplayPlaybackFailure('Demasiadas redirecciones en el servidor de vídeo.');
}
function madplayMain() {
    // No public install/configuration endpoint and no probing when the feature is disabled.
    $configFile=dirname(__DIR__).'/calamar-madplay-config.php';
    $config=is_file($configFile)?require $configFile:[];
    if(!is_array($config)||empty($config['enabled']))madplayAnswer(['error'=>'La fuente está pendiente de verificar y habilitar.'],503);
    $path=$_SERVER['PATH_INFO']??'';
    if(!preg_match('#^/match/([1-9][0-9]{0,9})/source/([0-9]{1,10})/(index\.m3u8|asset/([a-f0-9]{32})\.(m3u8|bin))$#',$path,$m))madplayAnswer(['error'=>'Ruta no válida.'],400);
    $match=(int)$m[1];$source=(int)$m[2];
    if(!in_array($match,$config['matches']??[],true))madplayAnswer(['error'=>'Partido no habilitado.'],403);
    if(!in_array($source,$config['sources'][$match]??[],true))madplayAnswer(['error'=>'Fuente no habilitada.'],403);
    $secret=$config['secret']??'';if(!is_string($secret)||strlen($secret)<32)madplayAnswer(['error'=>'Configuración incompleta del puente.'],503);
    header('Access-Control-Allow-Origin: *');header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');
    if($_SERVER['REQUEST_METHOD']==='OPTIONS') { header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');header('Access-Control-Allow-Headers: Range');http_response_code(204);return; }
    if(!in_array($_SERVER['REQUEST_METHOD'],['GET','HEAD'],true))madplayAnswer(['error'=>'Método no permitido.'],405);
    if(!function_exists('curl_init')||!function_exists('openssl_encrypt'))madplayAnswer(['error'=>'El hosting necesita cURL y OpenSSL.'],503);
    $directory=dirname(__DIR__).'/calamar-madplay-cache';
    if(!is_dir($directory)&&!mkdir($directory,0700,true))madplayAnswer(['error'=>'No se pudo preparar la caché privada.'],503);
    $file=$directory.'/'.$match.'-'.$source.'.json';$lock=fopen($file.'.lock','c');
    if(!$lock||!flock($lock,LOCK_EX))madplayAnswer(['error'=>'No se pudo bloquear la renovación de sesión.'],503);
    @chmod($file.'.lock',0600);$state=is_file($file)?json_decode(file_get_contents($file),true):[];if(!is_array($state))$state=[];
    $body=null;$error=null;
    try {
        $provider=new MadplayProvider('madplayHttp');
        $session=new MadplaySession($match,$source,$state,function($match,$source,$offered)use($provider,&$state){$s=$provider->resolve($match,$source?:($state['chosenSource']??0),$offered);$state['chosenSource']=$s['source'];return $s;},'madplayHttp','time',$secret);
        if($m[3]==='index.m3u8')$body=['status'=>200,'body'=>$session->playlist(),'headers'=>['content-type'=>'application/vnd.apple.mpegurl']];
        elseif(($m[5]??'')==='m3u8')$body=['status'=>200,'body'=>$session->playlist($m[4]),'headers'=>['content-type'=>'application/vnd.apple.mpegurl']];
        else $body=$session->segment($m[4],$_SERVER['HTTP_RANGE']??null);
    } catch(Throwable $e) {$error=$e;}
    // Persist the cooldown on failed requests too. An access denial must not hammer the API.
    $encoded=json_encode($state);if($encoded!==false&&file_put_contents($file,$encoded)!==false)@chmod($file,0600);
    flock($lock,LOCK_UN);fclose($lock);
    if($error) { $up=$error instanceof MadplayPlaybackFailure?$error->upstreamStatus:0;madplayAnswer(['error'=>$error instanceof MadplayPlaybackFailure?$error->getMessage():'No se pudo preparar la reproducción.','upstreamStatus'=>$up],in_array($up,[404,410,416],true)?$up:502); }
    http_response_code($body['status']);header('Cache-Control: no-store');header('Content-Type: '.($body['headers']['content-type']??'application/octet-stream'));
    foreach(['content-range','accept-ranges'] as $h)if(isset($body['headers'][$h]))header($h.': '.$body['headers'][$h]);
    if($_SERVER['REQUEST_METHOD']!=='HEAD')echo $body['body'];
}
if(PHP_SAPI!=='cli')madplayMain();
