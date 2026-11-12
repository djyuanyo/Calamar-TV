#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
config=/etc/calamar-acestream
app=/opt/calamar-acestream
state=/var/lib/calamar-ace-channels
route="include $config/nginx-register.conf;"

test -f "$config/channels.json"
test -f "$config/nginx-location.conf"
test -f "$app/add-channel.mjs"
nginx -t
/usr/bin/node --check registry.mjs
/usr/bin/node --check add-channel.mjs

install -d -o calamar-ace -g calamar-ace -m 0750 "$state"
install -m 0644 registry.mjs "$app/registry.mjs"
if [[ ! -e "$app/add-channel.pre-registry.mjs" ]]; then
    cp -p "$app/add-channel.mjs" "$app/add-channel.pre-registry.mjs"
fi
install -m 0644 add-channel.mjs "$app/add-channel.mjs"
if [[ ! -L "$config/channels.json" ]]; then
    cp -p "$config/channels.json" "$config/channels.pre-registry.json"
    install -o calamar-ace -g calamar-ace -m 0640 "$config/channels.json" "$state/channels.json"
    ln -s "$state/channels.json" "$config/channels.registry"
    mv -T "$config/channels.registry" "$config/channels.json"
fi
test "$(readlink -f "$config/channels.json")" = "$state/channels.json"

cat > /etc/systemd/system/calamar-ace-registry.service <<'UNIT'
[Unit]
Description=Calamar TV Ace Stream registry
After=network-online.target
Wants=network-online.target

[Service]
User=calamar-ace
Group=calamar-ace
StateDirectory=calamar-ace-channels
StateDirectoryMode=0750
ExecStart=/usr/bin/node /opt/calamar-acestream/registry.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=128M

[Install]
WantedBy=multi-user.target
UNIT

cat > "$config/nginx-register.conf" <<'NGINX'
location = /ace-register {
    access_log off;
    client_max_body_size 1k;
    proxy_read_timeout 9s;
    proxy_pass http://127.0.0.1:6881;
}
NGINX

systemctl daemon-reload
systemctl enable calamar-ace-registry.service
systemctl restart calamar-ace-registry.service
systemctl is-active calamar-ace-registry.service
added=no
if ! grep -Fxq "$route" "$config/nginx-location.conf"; then
    printf '\n%s\n' "$route" >> "$config/nginx-location.conf"
    added=yes
fi
if ! nginx -t || ! systemctl reload nginx; then
    if [[ "$added" == yes ]]; then
        sed -i '\|^include /etc/calamar-acestream/nginx-register.conf;$|d' "$config/nginx-location.conf"
    fi
    exit 1
fi
