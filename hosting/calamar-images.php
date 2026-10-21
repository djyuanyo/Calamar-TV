<?php
/** Authenticated image uploads. Repository credentials stay outside public_html. */
const IMAGE_REPO = 'djyuanyo/Calamar-TV';
const IMAGE_RAW = 'https://raw.githubusercontent.com/djyuanyo/Calamar-TV/main/web/images/';
const IMAGE_ADMIN = 'juanjocarrillo7@gmail.com';
const IMAGE_FIREBASE_KEY = 'AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk';
function imageConfigPath() { return getenv('CALAMAR_IMAGES_CONFIG') ?: dirname(__DIR__) . '/calamar-images-config.php'; }
function imageReply($status, $data) { http_response_code($status); header('Content-Type: application/json; charset=utf-8'); echo json_encode($data, JSON_UNESCAPED_SLASHES); }
function imageHttp($method, $url, $body = null, $token = null) {
    if (!function_exists('curl_init')) throw new RuntimeException('El hosting necesita la extensión cURL.');
    $headers = ['Accept: application/json', 'Content-Type: application/json'];
    if ($token !== null) { $headers[] = 'Authorization: Bearer ' . $token; $headers[] = 'X-GitHub-Api-Version: 2022-11-28'; }
    $curl = curl_init($url);
    curl_setopt_array($curl, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'CalamarTV-Images/1.0', CURLOPT_HTTPHEADER => $headers]);
    if ($body !== null) curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($curl); $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE); curl_close($curl);
    if (!is_string($raw) || strlen($raw) > 2000000) throw new RuntimeException('No se pudo conectar con el servicio de imágenes.');
    return [$status, json_decode($raw, true)];
}
function imageAdministrator($token, $lookup = 'imageHttp') {
    if (!is_string($token) || strlen($token) > 8192) return false;
    $parts = explode('.', $token); if (count($parts) !== 3) return false;
    $payload = json_decode((string)base64_decode(strtr($parts[1], '-_', '+/')), true);
    if (!is_array($payload) || ($payload['aud'] ?? '') !== 'menciamedia'
        || ($payload['iss'] ?? '') !== 'https://securetoken.google.com/menciamedia'
        || ($payload['exp'] ?? 0) <= time() || ($payload['firebase']['sign_in_provider'] ?? '') !== 'google.com') return false;
    // Google validates the token; decoded JWT claims alone are never trusted.
    [$status, $data] = $lookup('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' . IMAGE_FIREBASE_KEY, ['idToken' => $token]);
    $user = $data['users'][0] ?? [];
    return $status === 200 && ($user['localId'] ?? '') !== '' && ($user['localId'] ?? '') === ($payload['sub'] ?? null)
        && ($user['email'] ?? '') === IMAGE_ADMIN && ($user['emailVerified'] ?? false) === true
        && in_array('google.com', array_column($user['providerUserInfo'] ?? [], 'providerId'), true);
}
function imageDecode($image) {
    if (!is_string($image) || strlen($image) > 180000
        || !preg_match('~^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$~D', $image, $match)) throw new InvalidArgumentException('Imagen no válida o demasiado grande.');
    $bytes = base64_decode($match[2], true); $info = is_string($bytes) ? @getimagesizefromstring($bytes) : false;
    if (!$info || ($info['mime'] ?? '') !== 'image/' . $match[1] || $info[0] > 4096 || $info[1] > 4096) throw new InvalidArgumentException('El archivo no es una imagen JPEG, PNG o WebP válida.');
    $name = hash('sha256', $bytes) . '.' . ($match[1] === 'jpeg' ? 'jpg' : $match[1]);
    return [$bytes, $name];
}
function imageToken() {
    $path = imageConfigPath(); $config = is_file($path) ? @include $path : [];
    $token = getenv('CALAMAR_GITHUB_IMAGES_TOKEN') ?: (is_array($config) ? ($config['github_token'] ?? '') : '');
    return is_string($token) && preg_match('/^[A-Za-z0-9_]{20,300}$/D', $token) ? $token : '';
}
function imageSaveToken($token) {
    $path = imageConfigPath(); $temp = tempnam(dirname($path), '.calamar-images-');
    if ($temp === false) throw new RuntimeException('No se puede guardar la configuración privada.');
    try {
        if (!chmod($temp, 0600) || file_put_contents($temp, '<?php return ' . var_export(['github_token' => $token], true) . ";\n", LOCK_EX) === false
            || !rename($temp, $path)) throw new RuntimeException('No se pudo guardar la configuración privada.');
        if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    } finally { if (is_file($temp)) @unlink($temp); }
}
function imageUpload($image, $token, $request = 'imageHttp') {
    [$bytes, $name] = imageDecode($image);
    $api = 'https://api.github.com/repos/' . IMAGE_REPO . '/contents/web/images/' . $name;
    [$status, $existing] = $request('GET', $api . '?ref=main', null, $token);
    if ($status === 200) {
        $stored = base64_decode(preg_replace('/\s/', '', $existing['content'] ?? ''), true);
        if ($stored !== $bytes) throw new RuntimeException('La imagen existente no coincide con su identificador.');
        return ['url' => IMAGE_RAW . $name];
    }
    if ($status !== 404) throw new RuntimeException('GitHub rechazó la conexión. Revisa la credencial y el permiso Contents: lectura y escritura para Calamar-TV.');
    [$status, $result] = $request('PUT', $api, ['message' => 'Añadir imagen del catálogo', 'content' => base64_encode($bytes), 'branch' => 'main'], $token);
    if (!in_array($status, [200, 201], true)) throw new RuntimeException('GitHub no permitió guardar la imagen. Comprueba el permiso Contents: lectura y escritura.');
    return ['url' => IMAGE_RAW . $name];
}
function imageMain() {
    header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'], true)) { imageReply(403, ['error' => 'Origen no permitido.']); return; }
    if ($origin !== '') { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS'); header('Access-Control-Allow-Headers: Content-Type, Authorization');
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'OPTIONS') { http_response_code(204); return; }
    if ($method === 'GET') { imageReply(200, ['configured' => imageToken() !== '']); return; }
    if ($method !== 'POST') { imageReply(405, ['error' => 'Método no permitido.']); return; }
    try {
        $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer ([A-Za-z0-9_.-]+)$/D', $authorization, $auth) || !imageAdministrator($auth[1])) { imageReply(401, ['error' => 'Entra con la cuenta de administrador de Google y vuelve a intentarlo.']); return; }
        $body = file_get_contents('php://input', false, null, 0, 200001);
        if (strlen($body) > 200000) throw new InvalidArgumentException('La imagen supera el tamaño permitido.');
        $data = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
        if (($data['action'] ?? '') === 'configure') {
            $token = $data['token'] ?? '';
            if (!is_string($token) || !preg_match('/^[A-Za-z0-9_]{20,300}$/D', $token)) throw new InvalidArgumentException('La credencial de GitHub no tiene un formato válido.');
            [$status] = imageHttp('GET', 'https://api.github.com/repos/' . IMAGE_REPO, null, $token);
            if ($status !== 200) throw new InvalidArgumentException('GitHub no acepta esta credencial para Calamar-TV.');
            imageSaveToken($token); imageReply(200, ['configured' => true]); return;
        }
        if (($data['action'] ?? '') !== 'upload') throw new InvalidArgumentException('Acción no válida.');
        $token = imageToken(); if ($token === '') { imageReply(503, ['error' => 'Conecta GitHub en Administración → Imágenes en GitHub antes de subir fotos nuevas.']); return; }
        imageReply(200, imageUpload($data['image'] ?? null, $token));
    } catch (InvalidArgumentException | JsonException $e) { imageReply(400, ['error' => $e->getMessage()]); }
      catch (Throwable $e) { imageReply(502, ['error' => $e instanceof RuntimeException ? $e->getMessage() : 'No se pudo guardar la imagen.']); }
}
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { ini_set('display_errors', '0'); imageMain(); }
