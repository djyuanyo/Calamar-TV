# Calamar TV · Web, Android y Android TV

Plataforma OTT de canales en directo: la web y la app Android/TV muestran el mismo catálogo, formado por los canales de TDT en abierto y por los canales y eventos que añade el administrador.

## Cómo está organizado

| Parte | Dónde | Qué hace |
| - | - | - |
| Catálogo TDT | `data/tdt.json` | Canales españoles en abierto con sus emisiones oficiales `.m3u8`. Lo genera `tools/sync_tdt.py` a partir de [TDTChannels](https://github.com/LaQuay/TDTChannels) (atribución obligatoria, visible en la web y en la app). |
| Catálogo propio | Firestore `calamarCatalog/custom` (respaldo `data/custom.json`) | Canales/eventos del administrador (`channels`), destacados de portada (`featured`) y canales TDT ocultos (`hidden`). |
| Web | `web/` | Sitio estático publicado en GitHub Pages: portada con destacado, filas por categoría, buscador, reproductor HLS (hls.js) y panel de administración. |
| App | `app/` | Android 7.0+ y Android TV. Lee el catálogo propio de Firebase en tiempo real y los JSON de TDT publicados en `https://djyuanyo.github.io/Calamar-TV/data/`, los guarda en caché y lleva una copia incluida para funcionar sin conexión. Reproduce con Media3 ExoPlayer. |

`web/catalog.js` y `app/.../Catalog.java` aplican las mismas reglas (canales propios primero, ocultos fuera, destacados en el orden elegido, categorías en el mismo orden), así que la web y la app muestran lo mismo.

El workflow **Calamar TV · Web y catálogo** actualiza `data/tdt.json` cada 6 horas y publica la web. Cada cambio en `web/` o `data/` en `main` (el panel de administración guarda directamente en Firebase) vuelve a publicarla en 1–2 minutos. La app consulta el catálogo al abrirse, al volver a primer plano, cada 10 minutos y con **↻ Actualizar**.

## Administración

En la web: **Admin** (`#/admin`). Solo acepta la cuenta `juanjocarrillo7@gmail.com`.

La web y la app usan **Continuar con Google**, con Firebase Authentication en el proyecto existente **MenciaMediaTV** (`menciamedia`). Las reglas de Firestore permiten editar únicamente a `juanjocarrillo7@gmail.com`, con correo verificado y sesión de Google. Las demás cuentas no obtienen permiso de escritura. No se necesita un token de GitHub ni una contraseña propia de Calamar TV.

En Android: **Administrar**. Incluye alta, edición y retirada de canales o eventos, categorías, logos, varias fuentes y destacados. **Publicar desde Mis canales** permite compartir cada canal local de forma voluntaria. En televisores sin Credential Manager/Google Play Services se ofrece abrir la administración web; la lectura del catálogo público no requiere iniciar sesión.

Los cambios se guardan en el documento `calamarCatalog/custom` y se reciben automáticamente en la web y la app. Cada publicación usa una transacción con revisión para impedir que un dispositivo sobrescriba cambios recientes de otro. Los archivos de TDT y el catálogo incluido siguen disponibles como respaldo. Los identificadores de Firebase y de OAuth que aparecen en el cliente son públicos; no incluyen claves de servidor ni el secreto OAuth.

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

## Enlace directo a un canal

Cada canal tiene un enlace propio que abre directamente su reproductor en la web: `https://djyuanyo.github.io/Calamar-TV/#/canal/<slug>`. El slug se genera solo a partir del nombre del canal, sin tildes ni símbolos: «Canal Sur Andalucía» → `canal-sur-andalucia`, «Movistar LaLiga TV» → `movistar-laliga-tv`. Si dos canales se llaman igual, el segundo termina en `-2`, el tercero en `-3`, etc. Si cambias el nombre de un canal, cambia su slug; los enlaces antiguos con el identificador interno (por ejemplo `mio-…`) siguen funcionando.

El reproductor tiene el botón **Copiar enlace**. Si el navegador no permite copiar, muestra el enlace seleccionado para copiarlo a mano. Al abrir un canal desde la portada la dirección cambia a su enlace, de modo que se puede compartir y funciona con el botón Atrás. Un slug que no existe muestra un aviso; un canal sin emisión directa enlaza a su web oficial. Pruebas: `node --test tools/catalog_slugs.test.mjs`.

## Diseño y reproductor de la web

El desplegable **Fuentes** aparece siempre en los controles del reproductor. Mantiene la numeración del catálogo y muestra también las alternativas caducadas o incompatibles, deshabilitadas con su motivo. Si solo hay un enlace, muestra «Fuente 1». Los enlaces nuevos del administrador aparecen en el selector del reproductor abierto sin interrumpir la emisión actual. Pruebas: `node --test tools/player_sources.test.mjs`.

La web sigue el estilo de las plataformas deportivas de streaming: cabecera fija con sección activa subrayada, canal destacado a pantalla completa con selector, filas con flechas, tarjetas 16:9 y filtros fijos en la página de canales. Los colores de cada tarjeta salen del nombre del canal; no se usan marcas ni imágenes de terceros.

El reproductor ocupa toda la ventana y tiene controles propios: reproducir/pausar, volumen, **pantalla completa**, imagen en imagen, selector de calidad (cuando la emisión ofrece varias), etiqueta «DIRECTO» con salto al directo, y barra de progreso solo en vídeos que no son en directo. Los controles se ocultan solos tras unos segundos y reaparecen al mover el ratón, tocar la pantalla o usar el teclado.

| Tecla | Acción |
| - | - |
| `Espacio` o `K` | Reproducir / pausar |
| `F` | Pantalla completa |
| `M` | Silenciar |
| `↑` `↓` | Volumen |
| `←` `→` | Retroceder / avanzar 10 s (solo en vídeos que no son en directo) |
| `Esc` | Cierra el menú de calidad; en pantalla completa sale de ella (lo hace el navegador); si no, cierra el reproductor |

Con ratón, un clic pausa y un doble clic alterna la pantalla completa. En pantallas táctiles, un toque muestra u oculta los controles y la pantalla completa se bloquea en horizontal cuando el navegador lo permite. En iPhone la pantalla completa usa el reproductor del sistema. El volumen elegido se recuerda en el navegador. Mientras el reproductor está abierto, el resto de la página queda inactivo para el teclado y los lectores de pantalla.

## Cuando un canal no carga en la web

El reproductor de la web dice por qué falla en lugar de quedarse en blanco:

| Mensaje | Causa |
| - | - |
| «El enlace de este canal caducó el…» | El enlace lleva una marca de tiempo (`?token=…-1792097946-`, `?e=` o `?expires=`) y ya pasó. No se intenta la petición. Los enlaces con token duran pocas horas y hay que renovarlos en Administración. |
| «El servidor rechaza este enlace…» | El servidor respondió 401 o 403: no autorizado o caducado. |
| «El enlace ya no existe…» | 404 o 410. |
| «El servidor del canal no permite cargarlo desde otra web (CORS)…» | La petición no obtuvo respuesta. Es lo que ve el navegador cuando el servidor del vídeo no añade `Access-Control-Allow-Origin` para otras webs, o está bloqueado en la red. La web no puede saltarse esto: solo lo arregla quien controla ese servidor. La app Android no tiene esta limitación. |
| «La emisión no tiene un formato que el navegador entienda» / «El navegador no admite el vídeo…» | Lista o códecs que el navegador no puede reproducir. |

Al publicar, `tools/version_assets.py` añade `?v=<commit>` a cada script, hoja de estilos e importación local de la web. GitHub Pages deja los ficheros en caché unos 10 minutos. Sin versión, un navegador podía mezclar el `app.js` nuevo con un `catalog.js` antiguo y la web se quedaba en «Cargando canales…» hasta que caducara la caché. Con versión, cada publicación se carga entera. Pruebas: `tools/test_version_assets.py`.

Si un canal tiene varios enlaces, el reproductor prueba el siguiente cuando uno falla. Los enlaces con token caducado se saltan. Pruebas: `node --test tools/catalog_slugs.test.mjs tools/stream_errors.test.mjs`.

## Diseño y reproductor de la app (2.2.0)

La app Android y Android TV sigue el mismo diseño que la web: cabecera con la marca, pestañas con la sección abierta subrayada en lima, canal destacado grande con selector de otros destacados (en tablet y TV), filas con tarjetas 16:9 y filtros de categoría en forma de píldora. Cada tarjeta tiene el color que sale de su nombre, con el **mismo cálculo que la web** (`Palette.hue` y `hue()` de `web/app.js`; una prueba lo comprueba con valores sacados de la web), así que un canal se ve igual en los dos sitios. Un canal sin logo muestra sus iniciales. El foco del mando se ve con un contorno lima. «Mis canales» usa las mismas tarjetas.

El reproductor tiene el botón de **pantalla completa** en los controles de Media3: oculta el panel superior y las barras del sistema (también bajo la muesca), y en móviles gira a horizontal. En televisión no se bloquea la orientación. El botón Atrás sale de la pantalla completa antes de cerrar el reproductor, y si hay un error o se abre el modo web vuelve solo al panel para que se vea el mensaje y los botones. Una etiqueta «EN DIRECTO» aparece cuando la emisión es en directo. El panel superior tiene el botón Volver con icono, el título y las acciones (DNS, Diagnóstico, Renovar, Fuentes, Modo web, Chrome) como píldoras.

Pruebas nuevas: `PaletteTest`. La interfaz de la app se comprobó con el compilador contra Android 15, pero no se ha probado en un dispositivo ni en un televisor.

## Mis canales (solo app)

### Compatibilidad HLS en Android (2.2.1)

Los enlaces directos HTTPS `.m3u8` pueden usar **Modo web** dentro de la app. Si Media3 devuelve un error, se abre automáticamente el reproductor web con hls.js, el mismo motor y origen HTTPS que la web pública. El vídeo permanece dentro de la app y no vuelve a enviarse al motor nativo que acaba de fallar. **Modo nativo** permite volver a Media3; **Fuentes** permite elegir otra alternativa. La pantalla completa también está disponible en este modo y Atrás permite salir.

El reproductor integrado usa la red y DNS de Android System WebView, conservando la selección de DNS del motor nativo. No modifica el enlace, los tokens ni las cabeceras del proveedor. La URL firmada viaja en el fragmento de la dirección del reproductor, que no se envía al servidor de GitHub Pages. Los rechazos HTTP y enlaces caducados siguen mostrándose como errores; esta alternativa no garantiza que una emisión disponible en otro dispositivo o red funcione en Android.

Pruebas: `BrowserPlaybackTest`, `node --test tools/direct_player.test.mjs`. La reproducción de ZicoTV debe comprobarse en el dispositivo con un enlace vigente.

En **2.2.2**, un error de conexión durante la reproducción HLS activa un único reintento con HTTP/1.1 antes de abrir el modo web. Conserva el DNS elegido y la validación TLS. No se aplica este reintento a rechazos HTTP ni errores de decodificación. El diagnóstico incluye la fase de descarga (lista o fragmentos), bytes recibidos, estado del reproductor y la cadena de clases de la excepción, sin mensajes que puedan contener tokens. Que la prueba inicial dé HTTP 200 solo comprueba el acceso a la lista; no confirma la reproducción. La alternativa HTTP/1.1 es una medida de compatibilidad y no demuestra por sí sola la causa del fallo en un dispositivo.

La pestaña **Mis canales** guarda enlaces solo en el dispositivo (`user-channels.json`). Para mostrarlos también en la web: **Administrar → Continuar con Google → Publicar desde Mis canales**. Se conserva la copia local; no se publica nada automáticamente.

## Puesta en marcha

1. GitHub Pages solo publica repositorios privados con un plan de pago. Para el plan gratuito, haz público el repositorio (Settings → General → Danger Zone → Change visibility). El catálogo y la web no contienen credenciales; revisa igualmente el historial antes de hacerlo.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Ejecuta el workflow **Calamar TV · Web y catálogo** (Actions → Run workflow). La web queda en `https://djyuanyo.github.io/Calamar-TV/`.
4. Para firmar la app y poder actualizarla, añade en Settings → Secrets and variables → Actions los secretos `CALAMAR_KEYSTORE_BASE64`, `CALAMAR_KEYSTORE_PASSWORD`, `CALAMAR_KEY_ALIAS` y `CALAMAR_KEY_PASSWORD`. La clave se guarda fuera del repositorio. Todas las versiones deben firmarse con la misma; la primera APK firmada obliga a desinstalar una vez la versión de pruebas.

## Compilación y pruebas

El workflow **Calamar TV · APK Android y TV** compila release y debug, pasa Android Lint y las pruebas unitarias, comprueba que la APK incluye el catálogo y publica las APK y un ZIP de descarga en GitHub Releases. La APK de distribución debe llevar la firma persistente registrada en Firebase; la APK debug es solo para pruebas y no tiene esa identidad OAuth. Localmente: JDK 17, Gradle 8.9 y Android SDK 35, `gradle :app:assembleDebug :app:testDebugUnitTest`.

Pruebas: `CatalogTest` (reglas del catálogo y el `data/tdt.json` real), `UserChannelsTest`, `VideoResolverTest`, `PlayerDocumentTest`, `ConnectionReportTest`, y `tools/test_sync_tdt.py` para el lector de TDTChannels (`python -m unittest discover -s tools -p 'test_*.py'`).

La reproducción depende de cada emisora y de la red del usuario; las pruebas no sustituyen la comprobación en el dispositivo.

## DNS propio del reproductor (2.0.1)

El botón **DNS** permite elegir Cloudflare (por defecto), Google o el resolver del sistema. Cloudflare y Google usan DNS sobre HTTPS: las consultas de los dominios se envían cifradas al proveedor elegido. El arranque del resolver usa sus direcciones públicas conocidas, sin depender del DNS de Android para localizarlo. Los dominios del vídeo se resuelven normalmente; no se fijan direcciones de CDN ni se alteran tokens.

La selección se guarda solo en la app. El mismo cliente OkHttp y resolver sirven la página del reproductor, los enlaces directos, las listas HLS, los segmentos y las claves del vídeo. El resolver original funciona desde Android 5.0; desde 2.1.0 la app completa requiere Android 7.0 por los SDK actuales de Firebase. No depende de HttpEngine. No modifica los ajustes DNS del teléfono ni de la TV. En los modos seguros no hay vuelta silenciosa al DNS del sistema; se puede elegir otro proveedor desde el botón DNS.

Diagnóstico compara el acceso del sistema con el proveedor elegido y permite copiar un informe sin enlaces firmados o credenciales. El modo WebView y Chrome usan sus propios mecanismos de red; el DNS integrado se aplica a las consultas y reproducción nativas.

Un reinicio de conexión (RESET) no demuestra por sí solo un fallo DNS. Este cambio debe probarse sin VPN en el dispositivo afectado; no puede corregir todos los posibles bloqueos o fallos del proveedor. Se mantienen el catálogo OTT, la web, los canales personales y las alternativas de la versión 2.0.

## Verificación de Firebase

Las reglas publicadas están en `firebase/firestore.rules`; solo conceden lectura del documento público del catálogo y escritura a la cuenta indicada. El resto de rutas continúa cerrado. La base de datos Standard está en `europe-southwest1` (Madrid), con el plan Spark. GitHub Pages continúa siendo el alojamiento web.

Pruebas aisladas con Node 24 y JDK 21: `cd firebase && npm install && npm test`. El emulador comprueba lectura pública limitada, rechazo de otras identidades, escrituras del administrador, revisiones, tamaño y marcas de tiempo. No modifica producción. La compilación Android sigue usando JDK 17.
