<?php
/** Common HTTP IPTV validation; credentials remain in HTTPS headers. */
function httpTsSourceAllowed($address) {
    if (!is_string($address) || strlen($address) > 2048 || preg_match('/[\r\n]/', $address)) return false;
    $u = @parse_url($address);
    if (!is_array($u) || strtolower($u['scheme'] ?? '') !== 'http' || isset($u['user'])
        || isset($u['pass']) || isset($u['fragment'])) return false;
    $host = strtolower($u['host'] ?? '');
    if (!preg_match('/^[a-zA-Z0-9.-]+$/D', $host) || $host === 'localhost'
        || preg_match('/[.](?:localhost|local|internal)$/D', $host)) return false;
    $port = $u['port'] ?? 80;
    if ($port < 1 || $port > 65535) return false;
    if (filter_var($host, FILTER_VALIDATE_IP) && !publicIp($host)) return false;
    $path = $u['path'] ?? '';
    return (bool)preg_match('~[.]ts$~iD', $path)
        || (bool)preg_match('~^/(?:live/)?[^/]+/[^/]+/[0-9]+(?:[.]ts)?$~iD', $path);
}
/** MPEG-TS the hosting can read and convert for Chromecast: HTTP IPTV and also .ts addresses over HTTPS. */
function tsSourceAllowed($address) {
    if (httpTsSourceAllowed($address)) return true;
    return is_string($address) && stripos($address, 'https://') === 0 && httpTsSourceAllowed('http://' . substr($address, 8));
}
function publicIp($ip) {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)
        && (int)explode('.', $ip)[0] < 224
        && !preg_match('/^100[.](6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])[.]/', $ip);
}
function publicTarget($address, $resolver = null) {
    $u = @parse_url($address);
    if (!is_array($u) || !in_array(strtolower($u['scheme'] ?? ''), array('http', 'https'), true)
        || isset($u['user']) || isset($u['pass']) || preg_match('/[\r\n]/', $address)) return null;
    $host = $u['host'] ?? '';
    if (!preg_match('/^[a-zA-Z0-9.-]+$/D', $host)) return null;
    $port = $u['port'] ?? ($u['scheme'] === 'https' ? 443 : 80);
    if ($port < 1 || $port > 65535) return null;
    $ips = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) ? array($host) : ($resolver ? $resolver($host) : @gethostbynamel($host));
    if (!$ips) return null;
    foreach ($ips as $ip) {
        if (!publicIp($ip)) return null;
    }
    // Pin the validated IP so cURL cannot resolve the hostname to an internal address.
    return array('host' => $host, 'port' => $port, 'ip' => $ips[0]);
}
function redirectTarget($base, $location) {
    if (preg_match('/[\r\n]/', $location)) return null;
    if (preg_match('~^https?://~i', $location)) return $location;
    if (preg_match('~^[a-z][a-z0-9+.-]*:~i', $location)) return null;
    $u = parse_url($base);
    if (strpos($location, '//') === 0) return $u['scheme'] . ':' . $location;
    $root = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    if (strpos($location, '/') === 0) return $root . $location;
    $path = $u['path'] ?? '/';
    if (strpos($location, '?') === 0) return $root . $path . $location;
    return $root . substr($path, 0, strrpos($path, '/') + 1) . $location;
}

/**
 * Key the hosting's own video worker (calamar-cast.php) sends to calamar-tv-relay.php, so its single
 * connection to the provider is not cut every 120 seconds. Derived from the worker's secret; null until
 * calamar-cast.php has created it.
 */
function calamarWorkerKey(): ?string {
    $secret = @file_get_contents(sys_get_temp_dir() . '/calamar-cast-' . substr(hash('sha256', __DIR__), 0, 16) . '/secret');
    return is_string($secret) && strlen($secret) >= 32 ? hash_hmac('sha256', 'calamar-tv-relay worker', $secret) : null;
}
