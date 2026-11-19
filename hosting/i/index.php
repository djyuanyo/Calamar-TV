<?php
// Short address of a user's IPTV list, easy to type with a TV remote:
//   https://calamarmenciano.com/i/?CODIGO        WisePlay (folders, a folder per series, icons)
//   https://calamarmenciano.com/i/?CODIGO&m3u    M3U, for other IPTV apps
// The list itself is made by calamar-iptv.php, one folder up.
$query = (string)($_SERVER['QUERY_STRING'] ?? '');
$parts = explode('&', $query);
$_GET = array('lista' => (string)$parts[0]);
if (!in_array('m3u', $parts, true)) $_GET['formato'] = 'wiseplay';
require dirname(__DIR__) . '/calamar-iptv.php';
