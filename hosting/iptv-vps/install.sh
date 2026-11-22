#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077

app=/opt/calamar-iptv-vps
config=/etc/calamar-iptv-vps
nginx_parent=/etc/calamar-acestream/nginx-location.conf
include="include $config/nginx-location.conf;"

if [[ $(id -u) != 0 ]]; then echo 'Ejecuta este instalador como root en IONOS.' >&2; exit 1; fi
if [[ ! -f sources.json ]]; then echo 'Falta el registro privado sources.json.' >&2; exit 1; fi
if [[ ! -f "$nginx_parent" ]]; then echo 'No se encuentra la configuración de Nginx de video.calamarmenciano.com.' >&2; exit 1; fi
/usr/bin/node --check hls.mjs
/usr/bin/node --check upstream.mjs
/usr/bin/node --check register.mjs
/usr/bin/node --check access.mjs
/usr/bin/node --check http-stream.mjs
test -x /usr/bin/ffprobe
encoders=$(/usr/bin/ffmpeg -hide_banner -encoders 2>/dev/null)
if [[ "$encoders" != *' libx264 '* || "$encoders" != *' aac '* ]]; then echo 'FFmpeg necesita los codificadores libx264 y AAC.' >&2; exit 1; fi
nginx -t

install -d -m 0755 "$app" "$config"
install -m 0644 hls.mjs upstream.mjs register.mjs access.mjs http-stream.mjs "$app/"
install -m 0644 nginx-location.conf "$config/"
if [[ -f "$config/sources.json" ]]; then install -m 0600 "$config/sources.json" "$config/sources.previous.json"; fi
install -m 0600 sources.json "$config/sources.json"
install -m 0644 calamar-iptv-vps.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable calamar-iptv-vps.service
systemctl restart calamar-iptv-vps.service

# Check that the backend can start with the private registry before changing the public route.
ready=no
for attempt in {1..15}; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1 -X OPTIONS 'http://127.0.0.1:6883/iptv-hls/register' 2>/dev/null || true)
    if [[ "$status" == 204 ]]; then ready=yes; break; fi
    sleep 1
done
if [[ "$ready" == no ]]; then echo 'El servicio IPTV no arrancó. Revisa systemctl status calamar-iptv-vps.' >&2; exit 1; fi

added=no
if ! grep -Fxq "$include" "$nginx_parent"; then
    printf '\n%s\n' "$include" >> "$nginx_parent"
    added=yes
fi
if ! nginx -t || ! systemctl reload nginx; then
    if [[ "$added" == yes ]]; then sed -i '\|^include /etc/calamar-iptv-vps/nginx-location.conf;$|d' "$nginx_parent"; fi
    echo 'Nginx mantuvo su configuración anterior.' >&2
    exit 1
fi
printf '%s\n' 'IPTV instalado. Usa los enlaces HTTPS del archivo canales-vps.m3u.'
