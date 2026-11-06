<?php
if (PHP_SAPI !== 'cli' || $argc !== 3) exit(1);
try {
    $private = openssl_pkey_get_private('file://' . realpath($argv[1]));
    $raw = file_get_contents($argv[2], false, null, 0, 600000);
    $envelope = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    $sender = openssl_pkey_get_public($envelope['sender']);
    if (!$private || !$sender || !($shared = openssl_pkey_derive($sender, $private, 32))) throw new RuntimeException();
    $key = hash_hkdf('sha256', $shared, 32, 'calamar-drive-transfer-v1');
    $nonce = base64_decode($envelope['nonce'], true);
    $tag = base64_decode($envelope['tag'], true);
    $encrypted = base64_decode($envelope['encrypted'], true);
    if (strlen($nonce) !== 12 || strlen($tag) !== 16 || $encrypted === false) throw new RuntimeException();
    $plaintext = openssl_decrypt($encrypted, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag, 'calamar-drive-transfer-v1');
    if ($plaintext === false) throw new RuntimeException();
    [$secret, $authorization] = json_decode($plaintext, true, 512, JSON_THROW_ON_ERROR);
    $config = json_decode($authorization, true, 512, JSON_THROW_ON_ERROR);
    if (!preg_match('/^[0-9a-f]{64}$/D', $secret) || strlen($authorization) > 262144
        || !in_array($config['type'] ?? '', ['calamar_oidc', 'service_account'], true)) throw new RuntimeException();
    $state = '/var/lib/calamar-drive';
    $files = ['calamar-drive-secret.php' => '<?php return ' . var_export($secret, true) . ";\n",
        'calamar-drive-service.json' => $authorization];
    umask(0077);
    foreach ($files as $name => $content) {
        $path = $state . '/' . $name;
        if (file_exists($path)) throw new RuntimeException();
    }
    $temps = [];
    $installed = [];
    try {
        foreach ($files as $name => $content) {
            $tmp = tempnam($state, '.transfer-');
            if ($tmp === false) throw new RuntimeException();
            $temps[$name] = $tmp;
            if (file_put_contents($tmp, $content) !== strlen($content)
                || !chown($tmp, 'calamar-drive') || !chgrp($tmp, 'www-data') || !chmod($tmp, 0600)) throw new RuntimeException();
        }
        foreach ($temps as $name => $tmp) {
            $path = $state . '/' . $name;
            if (!link($tmp, $path)) throw new RuntimeException();
            $installed[] = $path;
        }
    } catch (Throwable $error) {
        foreach ($installed as $path) unlink($path);
        throw $error;
    } finally {
        foreach ($temps as $tmp) unlink($tmp);
    }
    echo "DRIVE_PRIVATE_FILES_INSTALLED\n";
} catch (Throwable $error) {
    fwrite(STDERR, "Drive private transfer failed. No credentials were printed.\n");
    exit(1);
}
