#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
umask 077

app=/opt/calamar-iptv-vps
service=calamar-iptv-vps.service
unit="/etc/systemd/system/$service"
if [[ $(id -u) != 0 || ! -r /etc/calamar-iptv-vps/sources.json || ! -f "$app/hls.mjs" || ! -f "$unit" ]]; then
    echo 'Ejecuta la actualización como root en el VPS donde está instalado IPTV.' >&2
    exit 1
fi
if [[ ! -x /usr/bin/ffprobe ]]; then
    echo 'Instala FFmpeg con FFprobe antes de actualizar IPTV.' >&2
    exit 1
fi

for file in hls.mjs register.mjs access.mjs http-stream.mjs; do /usr/bin/node --check "$file"; done
/usr/bin/node --input-type=module -e 'import {verifyAdmin} from "file:///opt/calamar-acestream/registry.mjs"; if (typeof verifyAdmin !== "function") process.exit(1);'

backup=$(mktemp -d /root/calamar-iptv-backup.XXXXXXXX)
for file in hls.mjs register.mjs access.mjs http-stream.mjs; do
    if [[ -f "$app/$file" ]]; then cp -p "$app/$file" "$backup/"; fi
done
cp -p "$unit" "$backup/"

apply_update() {
    install -m 0644 hls.mjs register.mjs access.mjs http-stream.mjs "$app/" &&
        install -m 0644 "$service" "$unit" && systemctl daemon-reload && systemctl restart "$service"
}

if apply_update; then
    for attempt in {1..15}; do
        status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1 -X OPTIONS 'http://127.0.0.1:6883/iptv-hls/register' 2>/dev/null || true)
        original=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 1 -X OPTIONS 'http://127.0.0.1:6883/iptv-hls/original' 2>/dev/null || true)
        if [[ "$status" == 204 && "$original" == 204 ]]; then
            printf '%s\n' 'IPTV actualizado. La app ya puede solicitar la señal original.'
            exit 0
        fi
        sleep 1
    done
fi

echo 'El registro nuevo no arrancó. Restaurando el servicio anterior.' >&2
cp -p "$backup/"*.mjs "$app/"
cp -p "$backup/$service" "$unit"
systemctl daemon-reload
systemctl restart "$service"
exit 1
