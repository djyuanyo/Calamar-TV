<?php
require_once __DIR__ . '/calamar-madplay-session.php';
/** Provider protocol captured from its public client, 2026-10-29. Transport is injected for offline tests. */
final class MadplayProvider {
    private $fetch;
    private const API = 'https://apis-data-defra10.tcpwe138stya.ru';
    private const KEY = 'YTc5ODFjYzllYjJmNGQxOWRjZmVhNTdiMTAxZWNkODk=';
    private const IV = 'ODAxN2QzYThmMTQwMGQyZg==';
    public function __construct(callable $fetch) { $this->fetch = $fetch; }
    /** A page identifies a match; never persist its temporary media address as the catalog entry. */
    public static function matchFromPage($address) {
        $p=parse_url(trim($address));$host=strtolower($p['host']??'');
        if(($p['scheme']??'')!=='https'||isset($p['user'])||isset($p['pass'])||isset($p['port']))return null;
        if(!($host==='mpanrc4imind.my'||substr($host,-strlen('.mpanrc4imind.my'))==='.mpanrc4imind.my'||$host==='madplay77.ru'||substr($host,-strlen('.madplay77.ru'))==='.madplay77.ru'))return null;
        return preg_match('#^/(?:[a-z]{2}/)?football/[^/]+-([1-9][0-9]{0,9})/[^/]+\.html$#',$p['path']??'',$m)?(int)$m[1]:null;
    }

    private static function varint($b, &$i) {
        $n=0; $shift=0;
        do { if ($i >= strlen($b) || $shift > 63) throw new MadplayPlaybackFailure('Protobuf incompleto.'); $c=ord($b[$i++]); $n|=($c&127)<<$shift; $shift+=7; } while ($c&128);
        return $n;
    }
    public static function protobuf($b) {
        if (!is_string($b) || strlen($b)>1048576) throw new MadplayPlaybackFailure('Respuesta API demasiado grande.');
        $out=[]; $i=0;
        while ($i<strlen($b)) {
            $t=self::varint($b,$i); $id=$t>>3; $w=$t&7;
            if ($id===0) throw new MadplayPlaybackFailure('Campo protobuf no válido.');
            if ($w===0) $v=self::varint($b,$i);
            elseif ($w===2) { $n=self::varint($b,$i); if ($n<0 || $n>strlen($b)-$i) throw new MadplayPlaybackFailure('Respuesta API truncada.'); $v=substr($b,$i,$n); $i+=$n; }
            elseif ($w===1 || $w===5) { $n=$w===1?8:4; if ($n>strlen($b)-$i) throw new MadplayPlaybackFailure('Respuesta API truncada.'); $v=substr($b,$i,$n); $i+=$n; }
            else throw new MadplayPlaybackFailure('Formato protobuf no compatible.');
            $out[$id][]=$v;
        }
        return $out;
    }
    private function api($path, $params=[]) {
        $r=call_user_func($this->fetch,self::API.$path.($params?'?'.http_build_query($params):''));
        if (($r['status']??0)!==200) throw new MadplayPlaybackFailure('La API no entrega la sesión.', $r['status']??0);
        $outer=self::protobuf($r['body']);
        if (($outer[2][0]??0)!==0 || !isset($outer[10][0])) throw new MadplayPlaybackFailure('La API rechazó la consulta.');
        return [self::protobuf($outer[10][0]),array_change_key_case($r['headers']??[],CASE_LOWER)];
    }
    public function sources($match) {
        [$body]=$this->api('/api/match/detail',['matchId'=>$match,'sportType'=>1,'language'=>4]); $out=[];
        foreach ($body[2]??[] as $raw) {
            $s=self::protobuf($raw);
            // Honour provider availability. Never activate unavailable/admin-disabled streams.
            if (($s[5][0]??0)!==1 || ($s[6][0]??0)!==0 || empty($s[1][0])) continue;
            $out[]=['id'=>$s[1][0], 'name'=>$s[3][0]??'Señal', 'siteType'=>$s[9][0]??0];
        }
        return $out;
    }
    private static function decodeUrl($input) {
        $out=''; for ($i=0;$i<strlen($input);$i++) { $n=ord($input[$i]); $out.=$n>=33&&$n<=126?chr(33+($n-33+47)%94):$input[$i]; }
        return substr($out,8);
    }
    public function resolve($match,$source=0,$offered=null) {
        $sources=$this->sources($match); $chosen=null;
        if ($source) { foreach ($sources as $s) if ($s['id']===$source) $chosen=$s; }
        else { $chosen=$sources[0]??null; foreach ($sources as $s) if (preg_match('/\b(?:ES|español|castellano)\b/iu',$s['name'])) { $chosen=$s; break; } }
        if (!$chosen) throw new MadplayPlaybackFailure('La fuente seleccionada ya no está disponible.',404);
        [$user]=$this->api('/api/user/info');
        [$body,$headers]=$this->api('/api/stream/detail',['matchId'=>$match,'sportType'=>1,'language'=>4,'streamId'=>$chosen['id'],'siteType'=>$chosen['siteType'],'country'=>$user[2][0]??'','continent'=>$user[3][0]??'']);
        $stream=self::protobuf($body[2][0]??'');
        if (($stream[1][0]??0)!==$chosen['id'] || ($stream[5][0]??0)!==1) throw new MadplayPlaybackFailure('La sesión no corresponde a la fuente seleccionada.');
        $url=self::decodeUrl($stream[4][0]??''); $session=$offered??($headers['rb-session']??'');
        // Encrypt only the session actually issued by the server, as its public client does.
        if (!$session || strlen($session)>4096 || !filter_var($url,FILTER_VALIDATE_URL) || strpos($url,'https://')!==0) throw new MadplayPlaybackFailure('El proveedor no entregó una dirección reproducible.');
        $cipher=openssl_encrypt($session,'aes-256-cbc',base64_decode(self::KEY),OPENSSL_RAW_DATA,base64_decode(self::IV));
        if ($cipher===false) throw new MadplayPlaybackFailure('No se pudo preparar la sesión entregada por el proveedor.');
        $p=parse_url($url); $signed='https://'.$p['host'].'/token-'.rawurlencode(base64_encode($cipher)).'a'.$p['path'].(isset($p['query'])?'?'.$p['query']:'');
        return ['url'=>$signed,'source'=>$chosen['id']];
    }
}
