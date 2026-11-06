#!/usr/bin/env bash
set -euo pipefail

[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -x /usr/sbin/php-fpm8.3 && -x /usr/sbin/nginx ]]
command -v php >/dev/null
php -l "$source_dir/../calamar-drive.php"
php -l "$source_dir/../calamar-http-source.php"

if ! command -v ffmpeg >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg
fi
if ! id calamar-drive >/dev/null 2>&1; then
    useradd --system --gid www-data --home-dir /var/lib/calamar-drive --shell /usr/sbin/nologin calamar-drive
fi

install -d -m 0755 /opt/calamar-drive /etc/calamar-drive
install -d -o calamar-drive -g www-data -m 0700 /var/lib/calamar-drive
install -m 0644 "$source_dir"/../calamar-{drive,http-source}.php /opt/calamar-drive/
install -m 0644 "$source_dir/drive-fpm.conf" "$source_dir/nginx-drive-location.conf" /etc/calamar-drive/
install -m 0644 "$source_dir/../calamar-drive.service" /etc/systemd/system/
install -m 0644 "$source_dir/nginx-drive-local.conf" /etc/nginx/sites-available/calamar-drive-local
local_config=/etc/nginx/sites-enabled/calamar-drive-local
if [[ ! -e "$local_config" && ! -L "$local_config" ]]; then
    ln -s ../sites-available/calamar-drive-local "$local_config"
    if ! nginx -t; then
        unlink "$local_config"
        exit 1
    fi
else
    nginx -t
fi

systemctl daemon-reload
systemctl restart calamar-drive
systemctl reload nginx
systemctl is-active calamar-drive nginx
curl --fail --silent --show-error --max-time 5 'http://127.0.0.1:8092/calamar-drive.php?status=1'
printf '\n'
