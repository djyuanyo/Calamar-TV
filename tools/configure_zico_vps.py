#!/usr/bin/env python3
"""Store the Zico API credential outside the public directory of the Calamar relay."""

import base64
import getpass
import grp
import os
from pathlib import Path
import re
import tempfile


def main():
    directory = Path("/var/www/calamar-relay")
    target = directory / "calamar-zico-config.php"
    if os.geteuid() != 0 or not (directory / "public" / "calamar-player.php").is_file():
        raise SystemExit("Ejecuta este script como root en el VPS del reproductor Calamar.")

    token = getpass.getpass("Token API de ZicoTV (entrada oculta, Enter para guardar): ")
    if not re.fullmatch(r"[!-~]{16,512}", token):
        raise SystemExit("El token no tiene un formato válido. La configuración sigue intacta.")

    encoded = base64.b64encode(token.encode("ascii")).decode("ascii")
    with tempfile.NamedTemporaryFile(dir=directory, prefix=".calamar-zico-", delete=False) as temporary:
        path = Path(temporary.name)
        try:
            temporary.write(f"<?php return base64_decode('{encoded}', true);\n".encode("ascii"))
            temporary.flush()
            os.fchown(temporary.fileno(), 0, grp.getgrnam("www-data").gr_gid)
            os.fchmod(temporary.fileno(), 0o640)
            os.replace(path, target)
        finally:
            path.unlink(missing_ok=True)
    print("Token guardado en el VPS.")


if __name__ == "__main__":
    main()
