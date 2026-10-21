"""Check the Google redirect chain offline, including unsafe redirects and provider blocks."""
import pathlib, shutil, subprocess, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
@unittest.skipUnless(shutil.which('php'),'PHP not installed')
class MatchResolverTest(unittest.TestCase):
    def test_google_short_link_redirects_and_rejects_other_targets(self):
        code=r'''
require 'hosting/calamar-match.php';
$calls=[];
$request=function($u)use(&$calls){$calls[]=$u;return ['status'=>302,'location'=>count($calls)===1?'https://www.google.com/share.google?q=RSJmsOE0s8wgQUT3n':'https://www.google.com/search?q=levante+ud+contra+athletic+club','body'=>''];};
$url=resolveGoogleMatch('https://share.google/RSJmsOE0s8wgQUT3n',$request);
if(strpos($url,'q=levante')===false||count($calls)!==2)exit(1);
foreach(['https://share.google.evil/a','http://share.google/a','https://user@share.google/a'] as $bad)if(matchGoogleAllowed($bad))exit(2);
$called=0;
try{resolveGoogleMatch('https://share.google/test',function($u)use(&$called){$called++;return ['status'=>302,'location'=>'http://127.0.0.1/private','body'=>''];});exit(3);}catch(RuntimeException $ok){}
if($called!==1)exit(4);
try{resolveGoogleMatch('https://share.google/test',function($u){return ['status'=>429,'location'=>'','body'=>''];});exit(5);}catch(RuntimeException $ok){}
'''
        result=subprocess.run(['php','-r',code],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
