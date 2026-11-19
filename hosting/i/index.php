<?php
// Short address of a user's IPTV list, easy to type with a TV remote:
//   https://calamarmenciano.com/i/?CODIGO        WisePlay (folders, a folder per series, icons)
//   https://calamarmenciano.com/i/?CODIGO&m3u    M3U, for other IPTV apps
// The list itself is made by calamar-iptv.php, one folder up.
$query = (string)($_SERVER['QUERY_STRING'] ?? '');
$parts = explode('&', $query);
$_GET = array('lista' => (string)$parts[0]);
if (!in_array('m3u', $parts, true)) $_GET['formato'] = 'wiseplay';
// …/i/?código&p=…: one video of the list, played only while the list is valid.
foreach ($parts as $part) if (strpos($part, 'p=') === 0) $_GET['p'] = substr($part, 2);
require dirname(__DIR__) . '/calamar-iptv.php';
