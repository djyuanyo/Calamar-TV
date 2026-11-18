#!/usr/bin/env python3
"""Install the restricted Zico admin route on the Calamar relay VPS."""
import os
import pathlib
import pwd
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path("/var/www/calamar-relay")
PUBLIC = ROOT / "public"
SITE = pathlib.Path("/etc/nginx/sites-available/calamar-public")
SOCKET = "/run/php/calamar-relay.sock"
ORIGIN = "https://raw.githubusercontent.com/djyuanyo/Calamar-TV"
FILES = ("calamar-images.php", "calamar-player.php", "calamar-zico-admin.php")
ROUTE = """
    location = /calamar-zico-admin.php {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root/calamar-zico-admin.php;
        fastcgi_param HTTP_AUTHORIZATION $http_authorization;
        client_max_body_size 4k;
        fastcgi_pass unix:/run/php/calamar-relay.sock;
    }
"""


def install_file(source, target):
    with tempfile.NamedTemporaryFile(prefix=".calamar-zico-", dir=target.parent, delete=False) as handle:
        scratch = pathlib.Path(handle.name)
    try:
        shutil.copy2(source, scratch)
        os.replace(scratch, target)
    finally:
        scratch.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or not re.fullmatch(r"[a-f0-9]{40}", sys.argv[1]):
        raise SystemExit("Uso como root: python3 install-zico-admin-vps.py <commit de Calamar TV>")
    revision = sys.argv[1]
    config = SITE.read_text()
    marker = "    include /etc/calamar-drive/nginx-drive-location.conf;"
    if "server_name video.calamarmenciano.com;" not in config or SOCKET not in config or "zico_config" not in config:
        raise SystemExit("La configuración de Nginx no corresponde al VPS de Calamar TV.")
    if ROUTE.strip() in config:
        updated = config
    elif "/calamar-zico-admin.php" in config or config.count(marker) != 1:
        raise SystemExit("Revisa la ubicación existente antes de instalar.")
    else:
        updated = config.replace(marker, ROUTE + marker, 1)

    pool = [path.read_text() for path in pathlib.Path("/etc/php").glob("*/fpm/pool.d/*.conf")]
    users = [re.search(r"(?m)^\s*user\s*=\s*(\S+)", block) for block in pool
             if re.search(r"(?m)^\s*listen\s*=\s*" + re.escape(SOCKET) + r"\s*$", block)]
    if len(users) != 1 or not users[0]:
        raise SystemExit("No se pudo identificar el usuario PHP del reproductor.")
    worker = pwd.getpwnam(users[0].group(1))
    if worker.pw_uid == 0:
        raise SystemExit("El reproductor debe usar un usuario PHP sin privilegios de root.")

    backup = pathlib.Path(tempfile.mkdtemp(prefix="calamar-zico-admin-", dir="/root"))
    stage = backup / "stage"
    stage.mkdir()
    for name in FILES:
        source = stage / name
        subprocess.run(["curl", "-fsS", "--max-time", "30", "--proto", "=https", "-o", str(source),
                        f"{ORIGIN}/{revision}/hosting/{name}"], check=True)
        subprocess.run(["php", "-l", str(source)], check=True)
        source.chmod(0o644)
    staged_site = stage / SITE.name
    staged_site.write_text(updated)
    shutil.copymode(SITE, staged_site)

    private = ROOT / "zico-private"
    if private.is_symlink():
        raise SystemExit("El directorio de configuración no puede ser un enlace simbólico.")
    private.mkdir(mode=0o700, exist_ok=True)
    os.chown(private, worker.pw_uid, worker.pw_gid)
    private.chmod(0o700)
    current = private / "calamar-zico-config.php"
    previous = ROOT / current.name
    if not current.exists() and previous.is_file():
        with current.open("xb") as copied:
            os.fchmod(copied.fileno(), 0o600)
            with previous.open("rb") as original:
                shutil.copyfileobj(original, copied)
            os.fchown(copied.fileno(), worker.pw_uid, worker.pw_gid)

    targets = [PUBLIC / name for name in FILES] + [SITE]
    for target in targets:
        if target.is_file():
            shutil.copy2(target, backup / target.name)
    installed = []
    try:
        for target in targets:
            install_file(stage / target.name, target)
            installed.append(target)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except (OSError, subprocess.CalledProcessError):
        for target in reversed(installed):
            previous_file = backup / target.name
            if previous_file.is_file():
                install_file(previous_file, target)
            else:
                target.unlink(missing_ok=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=False)
        raise
    print(f"Administración de Zico instalada. Respaldo: {backup}")


if __name__ == "__main__":
    main()
