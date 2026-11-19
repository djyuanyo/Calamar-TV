#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
app=/opt/calamar-acestream
hls_unit=/etc/systemd/system/calamar-ace-hls.service
backup=$(mktemp -d /var/backups/calamar-ace.XXXXXX)
chmod 0700 "$backup"

test -x /usr/bin/ffmpeg
/usr/bin/node --check relay.mjs
/usr/bin/node --check hls.mjs
cp -p "$app/relay.mjs" "$app/hls.mjs" "$hls_unit" "$backup/"
systemd-analyze verify "$PWD/calamar-ace-hls.service"
bash install.sh

rollback_playback() {
    install -m 0644 "$backup/relay.mjs" "$backup/hls.mjs" "$app/"
    install -m 0644 "$backup/calamar-ace-hls.service" "$hls_unit"
    systemctl daemon-reload
    systemctl restart calamar-acestream.service calamar-ace-hls.service
}
if ! install -m 0644 relay.mjs hls.mjs "$app/" \
    || ! install -m 0644 calamar-ace-hls.service "$hls_unit" \
    || ! systemctl daemon-reload \
    || ! systemctl restart calamar-acestream.service calamar-ace-hls.service \
    || ! systemctl is-active --quiet calamar-acestream.service \
    || ! systemctl is-active --quiet calamar-ace-hls.service \
    || ! curl -fsS --retry 3 --retry-connrefused --max-time 5 http://127.0.0.1:6882/ace-live/00000000000000000000000000000000.ts -X OPTIONS >/dev/null \
    || ! curl -fsS --retry 3 --retry-connrefused --max-time 5 http://127.0.0.1:6880/ace-hls/00000000000000000000000000000000/index.m3u8 -X OPTIONS >/dev/null; then
    rollback_playback
    exit 1
fi
printf 'Servicios activos. Copia de la configuración de vídeo: %s\n' "$backup"
