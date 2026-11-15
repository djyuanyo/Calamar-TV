<?php
// Install alongside calamar-images.php. Calamar TV generates the action code with Firebase.
require_once __DIR__ . '/calamar-images.php';

function reminderSend($data, $from, $lookup = 'imageHttp', $send = 'mail') {
    $code = $data['code'] ?? null;
    $email = $data['email'] ?? null;
    if (!is_string($code) || !preg_match('/^[A-Za-z0-9_-]{6,1024}$/D', $code)
        || !is_string($email) || !filter_var($email, FILTER_VALIDATE_EMAIL))
        throw new InvalidArgumentException('El recordatorio no contiene un código y un correo válidos.');
    // As checkActionCode() does, inspect the code without consuming it or changing the user.
    [$status, $action] = $lookup('POST',
        'https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=' . IMAGE_FIREBASE_KEY,
        ['oobCode' => $code]);
    if ($status !== 200 || ($action['requestType'] ?? '') !== 'VERIFY_EMAIL' || ($action['email'] ?? '') !== $email)
        throw new InvalidArgumentException('Firebase no reconoce el enlace para este correo. Genera otro recordatorio.');
    $link = 'https://menciamedia.firebaseapp.com/__/auth/action?' . http_build_query([
        'mode' => 'verifyEmail', 'oobCode' => $code, 'apiKey' => IMAGE_FIREBASE_KEY, 'lang' => 'es',
    ], '', '&', PHP_QUERY_RFC3986);
    $body = "Hola,\n\nConfirma tu correo para acceder a Calamar TV:\n$link\n\n"
        . "Si no has creado esta cuenta, puedes ignorar este mensaje.\n\nCalamar TV";
    return $send($email, 'Verifica tu correo de Calamar TV', $body, [
        'From' => "Calamar TV <$from>", 'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8',
    ]);
}

function reminderMain() {
    header('Cache-Control: no-store');
    header('Vary: Origin');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && !in_array($origin, ['https://djyuanyo.github.io', 'https://calamarmenciano.com', 'https://www.calamarmenciano.com'], true)) {
        imageReply(403, ['error' => 'Origen no permitido.']);
        return;
    }
    if ($origin !== '') header('Access-Control-Allow-Origin: ' . $origin);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'OPTIONS') {
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        http_response_code(204);
        return;
    }
    $from = getenv('CALAMAR_VERIFICATION_FROM') ?: 'no-reply@calamarmenciano.com';
    $ready = function_exists('mail') && function_exists('curl_init') && filter_var($from, FILTER_VALIDATE_EMAIL)
        && str_ends_with(strtolower($from), '@calamarmenciano.com');
    if ($method === 'GET') { imageReply(200, ['ready' => $ready]); return; }
    if ($method !== 'POST') { imageReply(405, ['error' => 'Método no permitido.']); return; }
    if (!$ready) { imageReply(503, ['error' => 'El envío de correo no está activo en el hosting.']); return; }
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    try {
        if (!preg_match('/^Bearer ([A-Za-z0-9_.-]{1,8192})$/D', $header, $matches) || !imageAdministrator($matches[1])) {
            imageReply(401, ['error' => 'Entra con la cuenta de administración de Google.']);
            return;
        }
        $raw = file_get_contents('php://input', false, null, 0, 4097);
        $data = is_string($raw) && strlen($raw) <= 4096 ? json_decode($raw, true) : null;
        if (!is_array($data)) throw new InvalidArgumentException('Datos de verificación no válidos.');
        if (!reminderSend($data, $from)) {
            imageReply(502, ['error' => 'El hosting no ha aceptado el correo. Comprueba el remitente en cPanel.']);
            return;
        }
        imageReply(200, ['sent' => true]);
    } catch (InvalidArgumentException $e) {
        imageReply(400, ['error' => $e->getMessage()]);
    } catch (Throwable $e) {
        imageReply(502, ['error' => 'No se pudo comprobar el enlace o enviar el recordatorio.']);
    }
}
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    ini_set('display_errors', '0');
    reminderMain();
}
