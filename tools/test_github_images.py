import json, pathlib, shutil, subprocess, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = shutil.which('php')

@unittest.skipUnless(PHP, 'PHP is required for the hosting tests')
class GithubImages(unittest.TestCase):
    def run_php(self, code):
        result = subprocess.run([PHP, '-r', "require 'hosting/calamar-images.php';\n" + code], cwd=ROOT, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_image_upload_validates_bytes_and_uses_a_content_addressed_fixed_path(self):
        data = self.run_php(r'''
        $image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
        $calls=[];
        $reply=imageUpload($image,'not-a-real-token',function($method,$url,$body,$token)use(&$calls){$calls[]=[$method,$url,$body,$token];return $method==='GET'?[404,[]]:[201,[]];});
        echo json_encode(['result'=>$reply,'calls'=>$calls]);''')
        self.assertTrue(data['result']['url'].startswith('https://raw.githubusercontent.com/djyuanyo/Calamar-TV/main/web/images/'))
        self.assertEqual([x[0] for x in data['calls']], ['GET', 'PUT'])
        self.assertEqual(data['calls'][1][2]['branch'], 'main')
        self.assertNotIn('not-a-real-token', data['result']['url'])

    def test_fake_image_and_tampered_existing_picture_are_rejected(self):
        data = self.run_php(r'''
        $errors=[];
        foreach(['data:image/png;base64,PHNjcmlwdD4=','data:image/jpeg;base64,'.str_repeat('YWFh',50000)] as $value)try{imageDecode($value);}catch(InvalidArgumentException $e){$errors[]=true;}
        $png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
        try{imageUpload($png,'dummy',fn()=>[200,['content'=>base64_encode('other')]]);}catch(RuntimeException $e){$errors[]=true;}
        echo json_encode($errors);''')
        self.assertEqual(data, [True, True, True])

    def test_google_checks_token_and_admin_identity_before_any_github_operation(self):
        data = self.run_php(r'''
        $payload=['aud'=>'menciamedia','iss'=>'https://securetoken.google.com/menciamedia','exp'=>time()+60,'sub'=>'admin-id','firebase'=>['sign_in_provider'=>'google.com']];
        $token='header.'.rtrim(strtr(base64_encode(json_encode($payload)),'+/','-_'),'=').'.signature';
        $user=['localId'=>'admin-id','email'=>IMAGE_ADMIN,'emailVerified'=>true,'providerUserInfo'=>[['providerId'=>'google.com']]];
        $ok=imageAdministrator($token,fn()=>[200,['users'=>[$user]]]);
        $forged=imageAdministrator($token,fn()=>[400,[]]);
        $user['email']='other@example.com';$other=imageAdministrator($token,fn()=>[200,['users'=>[$user]]]);
        echo json_encode([$ok,$forged,$other,imageAdministrator('invalid')]);''')
        self.assertEqual(data, [True, False, False, False])

    def test_repository_token_is_saved_in_private_file_not_a_public_response(self):
        data = self.run_php(r'''
        $path=tempnam(sys_get_temp_dir(),'images-test-');unlink($path);putenv('CALAMAR_IMAGES_CONFIG='.$path);
        imageSaveToken(str_repeat('a',30));echo json_encode([imageToken()===str_repeat('a',30),fileperms($path)&0777]);unlink($path);''')
        self.assertEqual(data, [True, 0o600])

if __name__ == '__main__': unittest.main()
