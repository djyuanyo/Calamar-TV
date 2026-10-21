<?php
declare(strict_types=1);
define('CALAMAR_CAST_TEST_ONLY', true);
require __DIR__ . '/calamar-cast.php';
ini_set('display_errors', '0');
header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer'); header('X-Frame-Options: DENY');
ini_set('session.cookie_httponly', '1'); ini_set('session.cookie_samesite', 'Strict');
ini_set('session.cookie_secure', '1'); session_start();
if (!isset($_SESSION['cast_install'])) $_SESSION['cast_install'] = bin2hex(random_bytes(32));
$csrf = $_SESSION['cast_install']; $message = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!is_string($_POST['csrf'] ?? null) || !hash_equals($csrf, $_POST['csrf'])) {
        http_response_code(403); exit('Vuelve a abrir esta página para instalar.');
    }
    session_write_close();
    @set_time_limit(300);
    $temporary = null; $archive = null; $lock = null;
    try {
        if (!function_exists('curl_init') || !function_exists('exec') || !function_exists('shell_exec')) {
            throw new RuntimeException('El hosting debe permitir cURL, exec y shell_exec.');
        }
        $folder = __DIR__ . '/calamar-cast-bin';
        if (!is_dir($folder) && !mkdir($folder, 0700)) throw new RuntimeException('No se pudo crear la carpeta de FFmpeg.');
        file_put_contents($folder . '/.htaccess', "Require all denied\n");
        $lock = fopen($folder . '/install.lock', 'c');
        if (!flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('La instalación ya está en curso. Espera unos minutos.');
        if (!castCapabilities()['ready']) {
            $temporary = sys_get_temp_dir() . '/calamar-ffmpeg-' . bin2hex(random_bytes(12));
            if (!mkdir($temporary, 0700)) throw new RuntimeException('No se pudo crear la carpeta temporal.');
            $archive = $temporary . '/ffmpeg'; $handle = fopen($archive, 'wb');
            $url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64';
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_FILE => $handle, CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 240, CURLOPT_MAXREDIRS => 5,
                CURLOPT_MAXFILESIZE_LARGE => 90000000, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_USERAGENT => 'CalamarTV-FFmpeg-Installer/2.0']);
            $downloaded = curl_exec($ch); $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch); fclose($handle);
            if (!$downloaded || $http !== 200) throw new RuntimeException('No se pudo descargar FFmpeg de GitHub. Vuelve a intentarlo.');
            if (hash_file('sha256', $archive) !== 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99') {
                throw new RuntimeException('La descarga no coincide con la firma SHA-256 esperada. No se ha ejecutado.');
            }
            // Raw portable Linux binary: no archive utility is required on the hosting.
            if (!copy($archive, $folder . '/ffmpeg')) throw new RuntimeException('No se pudo guardar FFmpeg.');
            chmod($folder . '/ffmpeg', 0700);
            file_put_contents($folder . '/ORIGEN.txt', "FFmpeg GPL v3 de eugeneware/ffmpeg-static\nDescarga original: $url\nCódigo y configuración: https://github.com/eugeneware/ffmpeg-static\nFFmpeg: https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz\nLicencia: https://www.gnu.org/licenses/gpl-3.0.html\n");
        }
        if (!castCapabilities()['ready']) throw new RuntimeException('FFmpeg se ha descargado, pero este servidor no permite ejecutarlo o no es compatible con Linux x86_64/glibc.');
        $message = 'Instalación completada. Ya puedes enviar el canal desde Calamar TV a Chromecast.';
    } catch (Throwable $error) {
        $message = $error instanceof RuntimeException ? $error->getMessage() : 'La instalación no se completó. Comprueba permisos y espacio en el hosting.';
    } finally {
        if ($temporary) {
            foreach (glob($temporary . '/*') ?: [] as $file) if (is_file($file)) @unlink($file);
            @rmdir($temporary);
        }
        if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); }
    }
}
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instalar Calamar Chromecast</title><style>body{font:16px Arial,sans-serif;max-width:650px;margin:40px auto;padding:20px;background:#0b0d10;color:#f5f5f5}button{font:inherit;padding:14px 22px;background:#d6ff00;border:0;border-radius:8px;cursor:pointer}p{line-height:1.6}a{color:#d6ff00}</style>
<h1>Calamar Chromecast · instalador 2</h1><p>Instala el conversor para enviar el canal TS/HEVC a la TV. La descarga de FFmpeg ocupa unos 80 MB, sin necesidad de tar ni xz y puede tardar varios minutos. Se descarga del proyecto original y se verifica su SHA-256 antes de ejecutarlo.</p>
<?php if ($message !== '') echo '<p role="status">' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</p>'; ?>
<form method="post"><input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES, 'UTF-8') ?>"><button type="submit">Instalar y comprobar FFmpeg</button></form>
<p><a href="calamar-cast.php">Comprobar estado de Chromecast</a></p>
<p>Usa CPU, disco y transferencia de tu hosting mientras alguien ve el canal. No contrata servicios ni activa pagos. La capacidad y el uso permitido dependen de tu plan.</p>
<p>Tras instalar, elimina solo <strong>calamar-cast-install.php</strong>. Conserva calamar-cast.php, calamar-tv-relay.php y la carpeta calamar-cast-bin.</p></html>