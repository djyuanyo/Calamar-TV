<?php
if (($_GET['username'] ?? '') !== 'calamar' || !is_string($_GET['password'] ?? null)) {
    http_response_code(403);
    exit;
}
$_GET = ['lista' => $_GET['password']];
require __DIR__ . '/calamar-iptv.php';
