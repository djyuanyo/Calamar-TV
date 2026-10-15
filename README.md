# Calamar TV · Web, Android y Android TV

Plataforma OTT de canales en directo: la web y la app Android/TV muestran el mismo catálogo, formado por los canales de TDT en abierto y por los canales y eventos que añade el administrador.

## Cómo está organizado

| Parte | Dónde | Qué hace |
| - | - | - |
| Catálogo TDT | `data/tdt.json` | Canales españoles en abierto con sus emisiones oficiales `.m3u8`. Lo genera `tools/sync_tdt.py` a partir de [TDTChannels](https://github.com/LaQuay/TDTChannels) (atribución obligatoria, visible en la web y en la app). |
| Catálogo propio | `data/custom.json` | Canales/eventos del administrador (`channels`), destacados de portada (`featured`) y canales TDT ocultos (`hidden`). |
| Web | `web/` | Sitio estático publicado en GitHub Pages: portada con destacado, filas por categoría, buscador, reproductor HLS (hls.js) y panel de administración. |
| App | `app/` | Android 5.0+ y Android TV. Lee los mismos JSON publicados en `https://djyuanyo.github.io/Calamar-TV/data/`, los guarda en caché y lleva una copia incluida para funcionar sin conexión. Reproduce con Media3 ExoPlayer. |

`web/catalog.js` y `app/.../Catalog.java` aplican las mismas reglas (canales propios primero, ocultos fuera, destacados en el orden elegido, categorías en el mismo orden), así que la web y la app muestran lo mismo.

El workflow **Calamar TV · Web y catálogo** actualiza `data/tdt.json` cada 6 horas y publica la web. Cada cambio en `web/` o `data/` en `main` (incluidos los del panel de administración) vuelve a publicarla en 1–2 minutos. La app consulta el catálogo al abrirse, al volver a primer plano, cada 10 minutos y con **↻ Actualizar**.

## Administración

En la web: **Admin** (`#/admin`). Solo acepta la cuenta `juanjocarrillo7@gmail.com`.

La web es estática, así que la protección real es un **token de GitHub** con permiso de escritura únicamente en este repositorio. La primera vez en cada navegador se introducen correo, una contraseña nueva y el token. El token se guarda cifrado en ese navegador con una clave derivada de la contraseña (PBKDF2 + AES-GCM). Las siguientes veces basta con correo y contraseña. Ninguna contraseña ni token se guarda en el repositorio, en la web publicada o en la APK.

Crear el token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: *Only select repositories* → `Calamar-TV`. Permissions → Repository → **Contents: Read and write**. Si el token se pierde o se filtra, revócalo allí y vuelve a configurar el navegador.

Desde el panel se puede:

- Añadir, editar y eliminar canales o eventos con nombre, categoría, logo y uno o varios enlaces (uno por línea). Si hay varios, se prueban en orden.
- Destacar canales en la portada y ocultar canales TDT.

Qué reproduce cada sitio:

| Enlace | Web | App |
| - | - | - |
| `https://…/….m3u8` | Sí, si el servidor permite reproducirlo desde otra web (CORS) | Sí |
| `.mp4` / `.webm` por https | Sí | Sí |
| `.ts`, enlaces `http://`, `.mpd` | No (el navegador no lo admite o lo bloquea en una web https) | Sí |
| Página de un reproductor (`https://…/player/4`) | No (el navegador no deja leer otra web) | Sí: obtiene la fuente actual y la renueva antes de caducar |

Los canales TDT sin emisión directa (por ejemplo Atresmedia o Mediaset, protegidas por la cadena) aparecen como **SU WEB** y abren la web oficial. Algunas emisiones solo funcionan desde España. El administrador es responsable de que los enlaces que publica sean propios o estén autorizados.

## Mis canales (solo app)

La pestaña **Mis canales** de la app sigue disponible para enlaces privados que no se publican: se guardan solo en el dispositivo (`user-channels.json`).

## Puesta en marcha

1. GitHub Pages solo publica repositorios privados con un plan de pago. Para el plan gratuito, haz público el repositorio (Settings → General → Danger Zone → Change visibility). El catálogo y la web no contienen credenciales; revisa igualmente el historial antes de hacerlo.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Ejecuta el workflow **Calamar TV · Web y catálogo** (Actions → Run workflow). La web queda en `https://djyuanyo.github.io/Calamar-TV/`.
4. Para firmar la app y poder actualizarla, añade en Settings → Secrets and variables → Actions los secretos `CALAMAR_KEYSTORE_BASE64`, `CALAMAR_KEYSTORE_PASSWORD`, `CALAMAR_KEY_ALIAS` y `CALAMAR_KEY_PASSWORD`. La clave se guarda fuera del repositorio. Todas las versiones deben firmarse con la misma; la primera APK firmada obliga a desinstalar una vez la versión de pruebas.

## Compilación y pruebas

El workflow **Calamar TV · APK Android y TV** compila release y debug, pasa Android Lint y las pruebas unitarias, comprueba que la APK incluye el catálogo y publica las APK como artefacto. Localmente: JDK 17, Gradle 8.9 y Android SDK 35, `gradle :app:assembleDebug :app:testDebugUnitTest`.

Pruebas: `CatalogTest` (reglas del catálogo y el `data/tdt.json` real), `UserChannelsTest`, `VideoResolverTest`, `PlayerDocumentTest`, `ConnectionReportTest`, y `tools/test_sync_tdt.py` para el lector de TDTChannels (`python -m unittest discover -s tools -p 'test_*.py'`).

La reproducción depende de cada emisora y de la red del usuario; las pruebas no sustituyen la comprobación en el dispositivo.
