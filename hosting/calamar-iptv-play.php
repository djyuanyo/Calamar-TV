<?php
define('CALAMAR_IPTV_LIBRARY', true);
require __DIR__ . '/calamar-iptv.php';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
if (!preg_match('~^/(live|movie|series)/calamar/~D', $path, $match)) iptvFail(404, 'Enlace de reproducción no válido.');
iptvXcMain($match[1]);
