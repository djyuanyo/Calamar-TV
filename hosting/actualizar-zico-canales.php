<?php
// One-use, fixed update: preserve the existing relay, VPS routing and private configuration.
function calamarZicoChannelPatch($code) {
    if (!is_string($code) || strlen($code) > 1048576) throw new RuntimeException('El archivo del reproductor no es válido.');
    $old = '#^/api/player/([0-9]{1,16})/?$#D';
    $new = '#^/(?:api/player|channels)/([0-9]{1,16})/?$#D';
    if (substr_count($code, $old) === 1) $code = str_replace($old, $new, $code);
    elseif (substr_count($code, $new) !== 1) throw new RuntimeException('Esta versión del reproductor necesita revisión. No se ha cambiado nada.');
    $open = <<<'PATCH'

    // CALAMAR_ZICO_CHANNEL_OPEN_V1
    $channelPlayer = playerZicoPage($page);
    if ($channelPlayer !== '' && preg_match('#^/channels/[0-9]+/?$#D', parse_url($page, PHP_URL_PATH) ?: '')) $page = $channelPlayer;
PATCH;
    $allowed = <<<'PATCH'

    // CALAMAR_ZICO_CHANNEL_ALLOW_V1
    $channelPlayer = playerZicoPage($page);
    if ($channelPlayer !== '') foreach ($catalogStreams as $saved => $_)
        if (playerZicoPage($saved) === $channelPlayer) return true;
PATCH;
    foreach ([['playerOpenPage', '$page, $token', 'CALAMAR_ZICO_CHANNEL_OPEN_V1', $open],
              ['playerAllowedPage', '$page, $catalogStreams', 'CALAMAR_ZICO_CHANNEL_ALLOW_V1', $allowed]] as $patch) {
        [$name, $parameters, $marker, $insert] = $patch;
        if (strpos($code, $marker) !== false) continue;
        $pattern = '/function\s+' . $name . '\s*\(\s*' . str_replace(' ', '\s*', preg_quote($parameters, '/')) . '[^)]*\)\s*\{/';
        if (preg_match_all($pattern, $code) !== 1) throw new RuntimeException('No se reconoce la función ' . $name . '. No se ha cambiado nada.');
        $code = preg_replace_callback($pattern, function($match) use ($insert) { return $match[0] . $insert . "\n"; }, $code, 1);
    }
    // Syntax-check the complete result without executing any of the existing server code.
    token_get_all($code, TOKEN_PARSE);
    return $code;
}

function calamarInstallZicoChannels($directory) {
    $target = $directory . '/calamar-player.php';
    if (is_link($target) || !is_file($target) || !is_readable($target)) throw new RuntimeException('Sube este archivo a la misma carpeta que calamar-player.php.');
    $lock = @fopen($directory . '/.calamar-zico-update.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('No se pudo bloquear el archivo para actualizarlo.');
    $temporary = false;
    try {
        $before = file_get_contents($target);
        $after = calamarZicoChannelPatch($before);
        if ($after === $before) return;
        if (!is_writable($directory)) throw new RuntimeException('El PHP no puede escribir en esta carpeta. Hay que aplicar el cambio desde el panel o la consola del servidor.');
        $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? $directory) ?: realpath($directory);
        $backupDirectory = dirname($public) . '/calamar-zico-backups';
        if (!is_dir($backupDirectory) && !@mkdir($backupDirectory, 0700)) throw new RuntimeException('No se pudo crear una copia privada del archivo. No se ha cambiado nada.');
        $backupDirectory = realpath($backupDirectory);
        if (!$backupDirectory || $backupDirectory === $public || strpos($backupDirectory, $public . DIRECTORY_SEPARATOR) === 0)
            throw new RuntimeException('La copia de seguridad debe estar fuera de la carpeta pública.');
        $backup = $backupDirectory . '/calamar-player-' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.php';
        $handle = @fopen($backup, 'x');
        if (!$handle) throw new RuntimeException('No se pudo guardar la copia de seguridad. No se ha cambiado nada.');
        @chmod($backup, 0600);
        try { if (fwrite($handle, $before) !== strlen($before)) throw new RuntimeException('La copia de seguridad no está completa.'); }
        finally { fclose($handle); }
        $temporary = tempnam($directory, '.calamar-zico-');
        if (!$temporary || file_put_contents($temporary, $after, LOCK_EX) !== strlen($after)
            || !chmod($temporary, fileperms($target) & 0777) || !rename($temporary, $target)) throw new RuntimeException('No se pudo sustituir el archivo. Se conserva la copia anterior.');
        if (function_exists('opcache_invalidate')) opcache_invalidate($target, true);
    } finally {
        if ($temporary && is_file($temporary)) @unlink($temporary);
        flock($lock, LOCK_UN); fclose($lock);
    }
}

if (PHP_SAPI === 'cli') return; // Test helpers can load the patch without running the installer.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
$message = ''; $success = false;
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    try {
        calamarInstallZicoChannels(__DIR__);
        $success = true;
        $message = 'Compatibilidad instalada. Recarga la web o vuelve a abrir el canal en la app para probar la señal de Zico.';
        if (!@unlink(__FILE__)) $message .= ' Borra ahora actualizar-zico-canales.php desde el panel.';
    } catch (Throwable $error) { http_response_code(500); $message = $error->getMessage(); }
}
?><!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actualizar canales Zico · Calamar TV</title>
<style>body{background:#0b0e11;color:#f5f5f5;font:18px system-ui;max-width:640px;margin:12vh auto;padding:24px;line-height:1.6}button{background:#d4ff00;border:0;border-radius:12px;padding:16px 24px;font:700 18px system-ui;cursor:pointer}p{color:#c8cdd2}</style>
<h1>Canales Zico · Calamar TV</h1>
<?php if ($message !== ''): ?><p role="status"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p><?php endif; ?>
<?php if (!$success): ?><p>Actualiza únicamente la compatibilidad con enlaces de canales. Conserva tu configuración del VPS y del reproductor, guarda una copia privada y elimina este instalador al terminar.</p><form method="post"><button type="submit">Actualizar canales Zico</button></form><?php endif; ?></html>
