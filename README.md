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

En Android: **Administrar**. Incluye alta, edición y retirada de canales o eventos, categorías, logos, varias fuentes y destacados. **Crear canal** publica fuentes nuevas. **Crear evento** abre un formulario independiente con nombre, portada (foto o URL HTTPS) y búsqueda de un canal creado; al pulsar el evento se reproducen las fuentes actuales de ese canal. Al eliminar un canal se retiran también sus eventos. En televisores sin Credential Manager/Google Play Services se ofrece abrir la administración web; la lectura del catálogo público no requiere iniciar sesión.

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

La app Android y Android TV sigue el mismo diseño que la web: cabecera con la marca, pestañas con la sección abierta subrayada en lima, canal destacado grande con selector de otros destacados (en tablet y TV), filas con tarjetas 16:9 y filtros de categoría en forma de píldora. Cada tarjeta tiene el color que sale de su nombre, con el **mismo cálculo que la web** (`Palette.hue` y `hue()` de `web/app.js`; una prueba lo comprueba con valores sacados de la web), así que un canal se ve igual en los dos sitios. Un canal sin logo muestra sus iniciales. El foco del mando se ve con un contorno lima. «Favoritos» guarda los canales marcados en cada dispositivo. Mantén pulsada una tarjeta (dedo o botón central del mando de Android TV) para añadir o quitar. El buscador está bajo la cabecera en web, Android y TV.

El reproductor tiene el botón de **pantalla completa** en los controles de Media3: oculta el panel superior y las barras del sistema (también bajo la muesca), y en móviles gira a horizontal. En televisión no se bloquea la orientación. El botón Atrás sale de la pantalla completa antes de cerrar el reproductor, y si hay un error o se abre el modo web vuelve solo al panel para que se vea el mensaje y los botones. Una etiqueta «EN DIRECTO» aparece cuando la emisión es en directo. El panel superior tiene el botón Volver con icono, el título y las acciones en este orden: pantalla completa (icono), Fuentes (solo si hay varias), Refrescar y Compartir pantalla.

Pruebas nuevas: `PaletteTest`. La interfaz de la app se comprobó con el compilador contra Android 15, pero no se ha probado en un dispositivo ni en un televisor.

## Favoritos y compatibilidad de reproducción

### Compatibilidad HLS en Android (2.2.1)

Los enlaces directos HTTPS `.m3u8` pueden usar **Modo web** dentro de la app. Si Media3 devuelve un error, se abre automáticamente el reproductor web con hls.js, el mismo motor y origen HTTPS que la web pública. El vídeo permanece dentro de la app y no vuelve a enviarse al motor nativo que acaba de fallar. **Modo nativo** permite volver a Media3; **Fuentes** permite elegir otra alternativa. La pantalla completa también está disponible en este modo y Atrás permite salir.

El reproductor integrado usa la red y DNS de Android System WebView, conservando la selección de DNS del motor nativo. No modifica el enlace, los tokens ni las cabeceras del proveedor. La URL firmada viaja en el fragmento de la dirección del reproductor, que no se envía al servidor de GitHub Pages. Los rechazos HTTP y enlaces caducados siguen mostrándose como errores; esta alternativa no garantiza que una emisión disponible en otro dispositivo o red funcione en Android.

Pruebas: `BrowserPlaybackTest`, `node --test tools/direct_player.test.mjs`.

En **2.2.2**, un error de conexión durante la reproducción HLS activa un único reintento con HTTP/1.1 antes de abrir el modo web. Conserva el DNS elegido y la validación TLS. No se aplica este reintento a rechazos HTTP ni errores de decodificación. El diagnóstico incluye la fase de descarga (lista o fragmentos), bytes recibidos, estado del reproductor y la cadena de clases de la excepción, sin mensajes que puedan contener tokens. Que la prueba inicial dé HTTP 200 solo comprueba el acceso a la lista; no confirma la reproducción. La alternativa HTTP/1.1 es una medida de compatibilidad y no demuestra por sí sola la causa del fallo en un dispositivo.

La pestaña **Favoritos** sustituye la antigua lista local. Los archivos locales antiguos no se borran. La API de Zico TV, su sincronización y la pestaña Fútbol se han retirado; los eventos se crean en el administrador y se comparten mediante el catálogo.

## Puesta en marcha

1. GitHub Pages solo publica repositorios privados con un plan de pago. Para el plan gratuito, haz público el repositorio (Settings → General → Danger Zone → Change visibility). El catálogo y la web no contienen credenciales; revisa igualmente el historial antes de hacerlo.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Ejecuta el workflow **Calamar TV · Web y catálogo** (Actions → Run workflow). La web queda en `https://djyuanyo.github.io/Calamar-TV/`.
4. Para firmar la app y poder actualizarla, añade en Settings → Secrets and variables → Actions los secretos `CALAMAR_KEYSTORE_BASE64` (el archivo .p12 en base64), `CALAMAR_KEYSTORE_PASSWORD`, `CALAMAR_KEY_ALIAS` y `CALAMAR_KEY_PASSWORD`. La clave se guarda fuera del repositorio. Con los secretos, la APK release y la debug se firman con la misma clave permanente (el registro de la compilación muestra sus huellas SHA-1 y SHA-256), así que cualquier APK nueva se instala encima de la anterior. La primera APK firmada obliga a desinstalar una vez las versiones anteriores. Las huellas deben estar añadidas en Firebase (Configuración del proyecto → app Android) para que funcione el acceso con Google en la app. Si falta el secreto, la compilación muestra un aviso.

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

Las reglas publicadas están en `firebase/firestore.rules`; solo conceden lectura del documento público del catálogo y escritura a la cuenta indicada, más las colecciones de audiencia descritas abajo. El resto de rutas continúa cerrado. La base de datos Standard está en `europe-southwest1` (Madrid), con el plan Spark. GitHub Pages continúa siendo el alojamiento web.

Pruebas aisladas con Node 24 y JDK 21: `cd firebase && npm install && npm test`. El emulador comprueba lectura pública limitada, rechazo de otras identidades, escrituras del administrador, revisiones, tamaño y marcas de tiempo. No modifica producción. La compilación Android sigue usando JDK 17.

## Agenda y administración (2.5.0)

El administrador tiene secciones para Canales, Eventos, Ligas y Equipos. Permite crear, editar, buscar y eliminar ligas y equipos con su logo o escudo; no se elimina una entidad mientras esté asociada a equipos o eventos. Los eventos admiten nombre, portada completa, canal existente, liga, local, visitante, fecha y hora de Madrid, temporada, jornada/fase, lugar, descripción, estado y destacado. La portada se puede subir como foto comprimida o añadir mediante URL HTTPS. Los registros anteriores sin agenda siguen siendo válidos y aparecen después de los que tienen fecha.

Cada evento tiene una dirección con el nombre del evento, como los canales: `#/evento/local-vs-visitante` (nombres repetidos: `-2`, `-3`… por fecha). Las direcciones antiguas con el identificador (`#/evento/evento-…`) siguen funcionando. El administrador permite abrirla o copiarla (en Android: Copiar enlace del evento). El evento resuelve las fuentes actuales del canal al abrirlo. Los eventos se ordenan de forma cronológica y muestran liga y horario. Los destacados de eventos y canales comparten un único slider que avanza cada 5 segundos. La web y la app permiten deslizar el slider con el dedo (en la web también con el ratón) y elegir cada destacado; los puntos de debajo indican cuál se ve. Android detiene el temporizador al salir de la pantalla. Si no hay destacados se usa el primer canal disponible. Las tarjetas y la portada de canales no llevan la etiqueta En directo y muestran el logo ampliado; el reproductor conserva sus indicadores de directo.

Pruebas: `tools/sports.test.mjs`, `SportsCatalogTest`, `CatalogEventsTest` y flujo en Chrome mediante `tools/browser_events_check.mjs` (catálogo aislado, sin escrituras reales en Firebase).

## Espectadores y estadísticas (2.6.0)

Mientras el reproductor web está abierto, la pestaña guarda en `calamarAudience/{sesión aleatoria}` qué canal o evento ve (`c:ID` o `e:ID`) y el minuto actual, y lo renueva cada minuto; al cerrarlo se borra. Junto a Pantalla completa, Refrescar y Compartir aparece el número de personas viendo ese mismo canal o evento (se cuentan las presencias de los últimos ~3 minutos y se actualiza cada 30 segundos). No se guarda ningún dato personal.

Cada apertura de un canal o evento suma una visita en `calamarVisits/AAAA-MM-DD` (día de Madrid), con un contador por canal (`c_ID`) y por evento (`e_ID`). Abrir un evento suma una visita al evento y otra al canal al que está asignado, así que el total de visitas es la suma de los canales. Las reglas solo permiten sumar 1 a un contador del día actual y solo el administrador puede leer las visitas.

En **Admin → Estadísticas** (`#/admin/estadisticas`): espectadores en vivo por canal y por evento (se refresca cada 20 segundos) y visitas por día (con los 30 días anteriores), por mes (día a día), por año (mes a mes) y por años, con tablas separadas de canales y eventos. Pulsar un canal o evento muestra su evolución en la gráfica.

Las portadas y tarjetas de eventos con fecha muestran el día y la hora de inicio hasta que empiezan; después, «En directo» (o «Finalizado»). La web cambia la etiqueta en el momento del inicio; Android, al refrescar el catálogo.

**Publicar las reglas** es necesario para que funcione: Firebase Console → Firestore → Reglas → pegar `firebase/firestore.rules` → Publicar (o `firebase deploy --only firestore:rules --project menciamedia`). Con el plan Spark cada espectador hace una escritura por minuto y una lectura cada 30 segundos; la cuota gratuita (20 000 escrituras y 50 000 lecturas al día) cubre unas 300 horas de visionado diarias. Por ahora solo cuenta la web: la app Android todavía no informa de espectadores ni visitas.

Pruebas: `tools/audience.test.mjs`, reglas en `firebase/catalog.test.mjs` y el flujo de Chrome.

## Portada de eventos y orden de categorías (2.7.0)

La página de inicio (web y app) muestra el slider de destacados y, debajo, solo los eventos creados: una fila por liga con su logo y su nombre, ordenadas por el próximo evento de cada liga, y los eventos de cada fila por fecha y hora, del más próximo al más lejano. Los eventos sin liga van al final en «Otros eventos». Los canales siguen en el menú **Canales**.

El orden, nombre y color de las categorías se gestionan en **Admin → Canales → Categorías** (ver 2.8.0).

Al crear o editar un canal, la categoría se elige en un desplegable con las categorías existentes o con **+ Nueva categoría…** para escribir una nueva. En la app Android el campo permite escribir o elegir de la lista.

## Colores y gestión de categorías (2.8.0)

Las tarjetas de los canales tienen el color de su categoría: todos los canales de Deportes del mismo color, todos los de Generalistas de otro, etc. Colores por defecto: Calamar TV verde oliva, Generalistas azul, Deportes verde, Informativos rojo, Infantiles naranja, Música morado y Autonómicos turquesa; las demás categorías reciben un color fijo según su nombre.

En **Admin → Canales → Categorías**:

- Se arrastra ⠿ (ratón o dedo) para cambiar el orden del menú Canales; con el teclado, flechas arriba/abajo sobre ⠿.
- Se cambia el nombre y el color de cada categoría. Los canales guardan el identificador original de la categoría, así que renombrar «Deportes» como «Fútbol» mueve también los canales TDT de Deportes.
- **Añadir categoría** crea una categoría nueva con su color (aparece en el desplegable de los canales). Las categorías sin canales se pueden eliminar.
- **Guardar categorías** publica los cambios (campo `categories` del catálogo: `id`, `name`, `color`), que se aplican en la web y en la app. **Restablecer** vuelve a los valores por defecto.

## Icono y favicon (2.8.1)

El icono de la app (también el icono adaptable de Android 8+), el banner de Android TV y los favicons de la web salen del logo de la cabecera (`web/assets/calamar-menciano-tv.png`). Si el logo cambia, se regeneran con `python tools/make_icons.py` (requiere Pillow).

## Reproductor a pantalla completa (2.8.2)

En la app, los canales y eventos se abren directamente a pantalla completa (sin barras del sistema y, en el móvil, en horizontal). El botón de pantalla completa del reproductor muestra el panel con fuentes, DNS y diagnóstico; Atrás cierra el reproductor. Si hay un error que leer, el reproductor sale de la pantalla completa para mostrarlo.

En Android TV, las tarjetas de eventos marcan su borde en color al pasar por encima, igual que las de canales. La portada de destacados solo tiene el botón **Ver ahora** (web y app); los canales siguen en el menú Canales.

## Enlaces de eventos y logos (2.8.3)

Al compartir un evento (botón **Compartir** del reproductor, **Copiar enlace** del administrador web y de la app) el enlace es de la web pública: `https://djyuanyo.github.io/Calamar-TV/evento/local-vs-visitante/`. `tools/event_pages.py` publica esa página para cada evento con su **foto de portada** y su **nombre** (liga, fecha y jornada debajo) para WhatsApp y las demás apps, y lleva al evento. El workflow de la web la regenera en cada publicación y cada 15 minutos, así que un evento nuevo tiene vista previa en unos 15 minutos; si se comparte antes, `404.html` lo abre igualmente (con la vista previa general). WhatsApp guarda cada vista previa un tiempo. Ya no se usa `calamar-evento.php` en el hosting.

Los logos de los canales ocupan toda la tarjeta, con un pequeño margen (web y app).

El botón de compartir pantalla (Chromecast) es solo el icono, en la web y en la app (2.8.4); su nombre se mantiene para lectores de pantalla y como texto de ayuda.

## Multipantalla (2.9.0)

Varios canales o eventos a la vez, en la web (menú **Multipantalla**, `#/multipantalla`) y en la app (botón **Multipantalla** de la cabecera). Se eligen de 2 a 6; con 2 se reparten arriba y abajo y con más forman una cuadrícula (3–4: 2×2, 5–6: 3×2) en horizontal (en móviles la web pasa a pantalla completa y gira la pantalla). Todos empiezan en silencio salvo el primero. Los botones (salir, pantalla completa y un botón 🔊/🔇 en cada vídeo) están ocultos y aparecen al tocar la pantalla durante 4 segundos (otro toque los oculta); el sonido solo cambia con el botón 🔊 de cada vídeo, así que tocar para ver los botones no cambia el audio. En Android TV moverse a un vídeo con el mando le da el sonido. El vídeo que suena lleva el borde verde (2.9.3). Cada vídeo prueba sus enlaces en orden y cuenta como visita. La dirección `#/multipantalla/c:la-1+e:final` abre directamente esa combinación. En la app se ofrecen los canales y eventos cuyo enlace es un vídeo directo (no las páginas de reproductor).

En la app (2.9.2), a pantalla completa, al tocar el vídeo aparecen arriba —sobre el vídeo, como en la web— el título y los botones (pantalla completa, fuentes, refrescar, compartir y enviar a la TV); se ocultan junto con los controles del reproductor. En los eventos, **Compartir** abre el menú de compartir de Android con el enlace de vista previa del evento.

En la web, al pulsar un canal o evento (tarjeta o «Ver ahora») el reproductor se abre a pantalla completa, como en la app (en móviles, en horizontal). Un enlace abierto directamente empieza en el reproductor normal, porque los navegadores solo permiten la pantalla completa tras un toque.


## Enlaces de canal con token temporal (2.20.14)

En el canal se guarda el enlace fijo `https://zicotv.cc/api/player/28`, en lugar del M3U8 con token. La web lee desde el dispositivo las fuentes públicas de ese reproductor, reproduce HLS en Calamar TV y vuelve a consultar la misma página 30 segundos antes de la caducidad indicada. Si devuelve el mismo token, espera al menos 15 segundos; si no hay fecha reconocible, consulta cada cinco minutos. Los errores 401/403, fallos fatales y bloqueos de carga provocan una nueva consulta con reintentos espaciados y cambio de CDN. Al cerrar o cambiar de canal se cancelan consultas, temporizadores y reproducción. Los tokens quedan solo en memoria.

Se necesita que el proveedor permita consultar la página y reproducir sus fuentes desde el navegador (CORS y las restricciones de la señal siguen aplicándose). Si no expone fuentes públicas, bloquea la consulta o falla repetidamente el vídeo, se conserva el reproductor de Calamar, se muestra el fallo y se sigue consultando con esperas de hasta 30 segundos. No cambia automáticamente al reproductor incrustado. No se envía ZicoTV al hosting. Android ya resuelve las páginas y programa la renovación desde el dispositivo; ahora reintenta también si falla una renovación mientras sigue reproduciendo y cuando la página devuelve un enlace caducado.

Pruebas: `node --test tools/renewable_player.test.mjs tools/player_sources.test.mjs` y `node tools/browser_events_check.mjs`.


## Reproducción de canales resueltos en Android (2.20.15)

La consulta de la página del canal usa también la conexión del dispositivo si el DNS seleccionado falla por un error de red; una respuesta HTTP de rechazo no cambia de conexión. El vídeo y las renovaciones continúan usando la conexión que obtuvo la fuente. Al cambiar manualmente de DNS se restablece esa elección. Si se cambia de red durante un fallo de vídeo, se vuelve a leer la página para obtener una fuente nueva.

El botón Fuentes permanece visible, incluso con una sola opción o mientras se buscan fuentes. Si no hay ninguna todavía permite volver a consultar el canal; las opciones muestran también el nombre del CDN. Los canales ZicoTV con enlace fijo siguen reintentando en el reproductor nativo, sin enviarlos automáticamente al hosting ni a una página incrustada.

Pruebas: `PlayerDocumentTest`, `VideoResolverTest` y `ResolvedPlaybackTest` (página HTTPS y vídeo reales servidos por un servidor local TLS en el emulador; reproducción nativa y recuperación después de un 403). La respuesta del proveedor desde el dispositivo sigue determinando si una señal externa puede reproducirse.


## RESET al consultar fuentes y selector de enlaces (2.20.16)

La consulta de documentos públicos ZicoTV y los M3U8 extraídos usan un perfil de navegador coherente. Ante un error de conexión, la consulta reintenta HTTP/1.1 con el mismo DNS antes de probar la conexión del dispositivo. Las respuestas HTTP de rechazo se conservan y no desencadenan cambios de protocolo o DNS.

Fuentes abre siempre un selector de los enlaces guardados del canal, incluso si todavía no se ha recibido ningún CDN. Después de consultar la página también muestra sus CDN disponibles. Elegir un vídeo directo funciona aunque la consulta de la página haya fallado. No se inventan direcciones CDN cuando el proveedor aún no las ha devuelto.

Pruebas: casos unitarios de RESET/HTTP1 y rechazo HTTP; ResolvedPlaybackTest verifica reproducción HTTPS nativa, coherencia del perfil de consulta/vídeo, recuperación del token y elección del enlace alternativo cuando la página devuelve un error.


## Conexión Chromium y controles visibles (2.20.17)

Si ZicoTV funciona en Chrome pero la consulta de la app falla por conexión, la app prueba Cronet (motor de red Chromium) para leer la página y después reproducir su HLS en el mismo ExoPlayer de Calamar. Incluye la biblioteca nativa para Android y Android TV sin requerir Google Play ni una VPN instalada. Los rechazos HTTP y la validación TLS siguen aplicándose. No se envía la señal a un proxy ni se muestra el reproductor de ZicoTV. Este cambio requiere comprobar su resultado en la conexión concreta del usuario: una prueba local no demuestra que una señal externa vaya a estar disponible.

Los controles permanecen visibles mientras no hay vídeo o está cargando. Fuentes usa selección única y marca la URL seleccionada: el CDN actual, si ya se ha obtenido, o el enlace del canal mientras se consulta. El diagnóstico compara también Chromium con los otros motores sin incluir tokens.

Pruebas: ResolvedPlaybackTest comprueba controles durante un error de consulta y la fuente marcada, además de la reproducción/resolución existentes. ChromiumPlaybackTest verifica conexiones reales con Cronet y decodificación HLS nativa de un vídeo local.

## Fuentes Android, rendimiento TV y actualizaciones (2.20.18)

- Android y Android TV excluyen los enlaces cuyo host es `zicotv.cc` o uno de sus subdominios, tanto páginas como CDN. Se usan las demás fuentes en su orden; el catálogo compartido y la web conservan ZicoTV. Si no hay alternativa, la app informa de que el canal está disponible en la web.
- En TV las filas de canales, eventos y vídeos se crean al acercarse a la pantalla y liberan sus vistas al alejarse. El carrusel destacado deja de reconstruirse automáticamente cada cinco segundos. Las imágenes se reducen antes de decodificarlas, incluidas las portadas base64, con dos descargas simultáneas y solicitudes compartidas por URL.
- La carga de GitHub y la recepción del catálogo compartido trabajan en ejecutores independientes. Al abrir o actualizar se consulta explícitamente el servidor de Firestore; su caché se diferencia de una respuesta actual y se ignoran revisiones anteriores. No se reconstruye la pantalla si el contenido no cambia. La versión instalada aparece en el estado del catálogo.
- Se comprueban nuevas versiones al abrir la app (máximo una vez cada seis horas por sesión), además del botón «Actualizaciones» (↓). El aviso permite descargar mediante Android y abrir su instalador. La primera instalación puede requerir autorizar a Calamar TV como fuente de instalación. El usuario confirma cada descarga e instalación; no se instala en silencio.
- El workflow publica `Calamar-TV-update.json` después de la APK firmada, con versión, tamaño y SHA-256. La app verifica el archivo y su identificador/versión antes del instalador. Esta primera versión con actualizador debe instalarse manualmente.
- Verificación: pruebas del filtrado por host sin modificar el catálogo web, integridad del manifiesto/descarga, vídeo real con fuentes Zico excluidas y catálogo de 500 canales con carga y liberación de filas. Las pruebas de emulador no sustituyen una comprobación en el modelo de TV afectado.

## «Continuar viendo» en todos los dispositivos (2.20.19)

- Con una cuenta iniciada, las películas y capítulos a medias se guardan también en Firestore (`calamarProgress/<uid>`). La web y la app (Android y Android TV) muestran la misma fila «Continuar viendo» en cualquier dispositivo con esa cuenta. Sin cuenta, todo sigue guardándose solo en el dispositivo.
- Para cada título gana lo último que se hizo en cualquier dispositivo: verlo otra vez o quitarlo. Lo quitado o terminado se recuerda 60 días, para que otro dispositivo no lo traiga de vuelta. Se mantiene una entrada por serie y las 20 más recientes.
- Cuándo se sincroniza: la web al iniciar sesión y al mostrar la portada (como mucho cada 30 s), y 15 s después de cada cambio; la app al volver a la pantalla principal y 3 s después de cada cambio. Un capítulo empezado en otro dispositivo toma el enlace y las marcas de intro y créditos del catálogo de vídeos.
- Reglas: cada cuenta solo lee y escribe su propio documento (`firebase/firestore.rules`). **Hay que publicar las reglas nuevas en la consola de Firebase.**
- LuluStream en el administrador: cada consulta tiene un tiempo máximo (12 s directa, 50 s por el hosting, que espera hasta 35 s a LuluStream) y avisa si no hay respuesta, en lugar de quedarse en «Leyendo…». Las carpetas se leen de una en una; si el navegador no puede llamar a la API, las siguientes consultas van directas al hosting, y una consulta sin respuesta se repite una vez.

## Películas y series en la portada, y Top 10 de la semana (2.20.20)

- En Administración → Pelis y series, cada título tiene «☆ Destacar». Los títulos «En portada» se suman a los eventos y canales destacados del carrusel de inicio (web y app), con su imagen de fondo de TMDB, año, géneros, nota y sinopsis. «Ver ahora» reproduce la película; en las series lleva a sus episodios.
- «Top 10 de la semana» en la portada: tus títulos ordenados primero por las tendencias de la semana en TMDB (`/trending/all/week`) y después por su popularidad en TMDB. Se recalcula solo una vez al día al abrir esa página del administrador, o con «Actualizar el top con TMDB». TMDB no ofrece el top de una plataforma concreta; lo que mide es lo más visto y comentado en general esa semana, y aquí solo cuentan los títulos que tienes en el catálogo.

## Top de películas y top de series por separado (2.20.21)

- La portada muestra dos filas: «Top N películas de la semana» y «Top N series de la semana», con hasta 10 títulos cada una (o los que haya). Cada sección se ordena por su cuenta, con las tendencias de TMDB y la popularidad. Los documentales no tienen top.
- Web: mientras la biblioteca está oculta al público, la portada del administrador vuelve a dibujarse al confirmarse la sesión, para que aparezcan «Continuar viendo», los títulos «En portada» y los tops (antes solo se veían al recargar en una página de la biblioteca).

## Eventos en canales de TDT (2.20.22)

- Al crear o editar un evento en la web de administración, la lista de canales muestra primero «Tus canales» y después «Canales de TDT»: los de TDTChannels que se ven en el catálogo (los ocultos no salen) y que se pueden reproducir.
- Las versiones de la app anteriores a la 2.20.22 solo aceptan eventos cuyo canal esté entre los creados. Para no romperlas, cada canal de TDT usado por un evento o un partido importado se guarda también como copia en `channels`, marcada con `tdt: true`. La web y la app nuevas usan siempre el canal de la lista de TDT, con sus enlaces actualizados; la copia solo sirve si TDT deja de tenerlo. Las copias no aparecen en «Canales creados», se actualizan en cada guardado y desaparecen cuando ya no las usa ningún evento.
- Si se oculta un canal de TDT, sus eventos dejan de mostrarse, igual que el canal.

## Pronóstico de Polymarket en los partidos (2.20.31)

- En la pestaña **General** del centro del partido (web y app Android en el móvil) aparece «Pronóstico de Polymarket» con la probabilidad de victoria local, empate y victoria visitante según el mercado de predicción de Polymarket, el volumen en juego y un enlace a su página.
- Se lee de la API pública `gamma-api.polymarket.com` (solo lectura, sin cuenta ni claves): se buscan los partidos de fútbol que empiezan 45 minutos antes o después del inicio y se elige el de los mismos equipos, aunque vengan en orden inverso. Se actualiza como mucho cada 2 minutos y deja de mostrarse al terminar el partido.
- Los porcentajes se redondean para que sumen exactamente 100. Si Polymarket no tiene mercado abierto para el partido, no se muestra nada.
- No aparece en Android TV ni en los eventos sin enlace del partido.

## Votación 1X2 de los usuarios (2.20.32)

- En la pestaña **General** del partido (web y app Android en el móvil, no en Android TV) aparece «¿Quién ganará? Vota» con tres botones: **1** (local), **X** (empate) y **2** (visitante). Al votar se ven los porcentajes de todos los votos y el total; se puede votar y cambiar el voto antes y durante el partido (2.20.33: antes se cerraba al empezar y la tarjeta no salía en los partidos en directo). Al terminar, la tarjeta muestra el resultado de la votación cerrada.
- Los votos se guardan **en el hosting**, no en Firebase: `hosting/calamar-votes.php`, subido a `calamarmenciano.com/calamar-votes.php`. Guarda un archivo JSON pequeño por partido (unos 30 bytes por voto) una carpeta por encima de la web (`calamar-votes/`) o, si no se puede, en `calamar-votes-data/` junto al PHP, cerrada con su `.htaccess`. Los partidos de hace más de 120 días se borran solos.
- Un voto por navegador o instalación de la app y partido: cada uno guarda un identificador aleatorio que no identifica a nadie, y el hosting solo guarda su huella (hash). El partido tiene la misma clave en la web y en la app (`2026-10-30-villarreal-espanyol`). Como mucho 60 votos cada 10 minutos desde la misma conexión.
- Como no hace falta iniciar sesión, quien borre los datos del navegador o reinstale la app puede volver a votar: es una encuesta de opinión, no un recuento exacto.
- Pruebas: `tools/votes.test.mjs`, `tools/test_votes.py` (el PHP con su servidor), `VotesTest`.

## Fotos de las alineaciones antes del partido

- `hosting/calamar-lineups.php` sacaba las fotos solo de las estadísticas de API-Football, que no existen hasta que empieza el partido (y una respuesta vacía se guardaba 30 minutos). Ahora, desde 75 minutos antes del inicio, si aún no hay estadísticas pide la **alineación publicada** (`/fixtures/lineups`) y toma la foto de cada jugador por su id; se vuelve a preguntar cada 5 minutos hasta que sale y después se guarda 6 horas. Las notas siguen llegando con el partido empezado.
- **Hay que subir el `calamar-lineups.php` nuevo al hosting.**

- 2.20.33: el PHP decide cada cuánto refrescar por la hora de inicio (la lista de partidos del día se guarda 6 horas y su estado podía decir «sin empezar» con el partido en juego), y si API-Football corta por el límite de peticiones por minuto devuelve lo último guardado en vez de un error. Si API-Football no tiene la alineación de un partido (pasa en categorías inferiores), no hay fotos.

## Porra del partido: votos y Polymarket en una sola tarjeta (2.20.34)

- La votación de los usuarios y el pronóstico de Polymarket van juntos en la tarjeta **«Porra · ¿Quién gana?»** (web y app en el móvil, no en Android TV), con el diseño de las páginas de eventos conocidas:
  - Cabecera con el **favorito** y un botón para plegar la tarjeta (se recuerda en cada dispositivo).
  - Tres casillas (local, empate, visitante): el número grande es la **probabilidad en Polymarket** y la barra pequeña, el **% de votos de la porra**. Tocar una casilla vota (hasta el final del partido). Sin mercado en Polymarket, el número grande son los votos.
  - **Evolución en Polymarket**: gráfica de las tres probabilidades en el último día (`clob.polymarket.com/prices-history`, un punto cada 10 minutos).
  - Mercados de goles de Polymarket: **+1,5**, **+2,5** y **+3,5 goles** y **ambos marcan** (del evento «More Markets» del partido).
  - Pie: «Número: probabilidad en Polymarket · barra: votos de la porra (N votos)» y enlace a Polymarket.

## Marcadores de las tarjetas sin saturar ESPN (2.20.34)

- Con los partidos importados, la web pedía cada 30 segundos el resumen completo de ESPN (unos 440 KB) de **cada** tarjeta. ESPN cortaba las peticiones (sin cabecera CORS) y el partido abierto se quedaba sin estadísticas: «No se pudieron cargar los datos del partido».
- Ahora los marcadores de las tarjetas salen del **marcador del día** de ESPN (`scoreboard?dates=…`, una petición por día para todos los partidos). Solo los que no aparecen ahí (algunas copas) se piden uno a uno, cuatro por vuelta. El resumen completo solo se pide para el partido abierto. Igual en la web y en la app.

## Fila «Eventos En Directo» (2.20.35)

- Primera fila de la portada, justo debajo del carrusel destacado (web y app; los mismos eventos siguen también en la fila de su liga, como copia): los **eventos de hoy** (día de Madrid) que **tienen vídeo** (canal o enlaces), ordenados por hora de inicio. Los que no tienen canal todavía («Canal por confirmar») no salen. Un partido empezado antes de medianoche sigue en la fila mientras puede estar en juego.

## Estadísticas solo de ESPN (2.20.37)

- Se quita la consulta de estadísticas a API-Football (2.20.36): las estadísticas vuelven a salir solo de ESPN, el partido del enlace de la competición, como antes. Si ESPN no tiene las de un partido pequeño, salen como las da (a 0, con las tarjetas).
- Las alineaciones siguen con las fotos y notas de API-Football (`calamar-lineups.php`).

## Pelis y series: enlaces aunque estén ocultas y estadísticas propias (2.20.37)

- Con la biblioteca oculta a los usuarios, sus listas siguen sin verse, pero **el enlace de una película o serie** (`#/peliculas/<id>`, sus capítulos y `…/ver`) se abre para cualquiera.
- Las películas, series y documentales tienen **estadísticas propias**: en vivo (`l:<id>`) y visitas por día (`l_<id>`), todos los capítulos de una serie juntos. En Administración → Estadísticas salen en «Pelis y series» y suman al total. Web y app.
- Su reproductor (web y app) **no muestra** «personas viendo».
- **Hay que publicar las reglas nuevas** de `firebase/firestore.rules` en Firebase Console → Firestore → Reglas (aceptan `l:` y `l_`); sin ellas no se guardan las estadísticas de pelis y series.

## Filtros de pelis y series y «Recién llegada» (2.20.38)

- En Películas, Series y Documentales (web y app), además de la categoría: **año**, **plataforma** (dónde se puede ver en España según TMDB), **orden** (añadidas recientemente, más nuevas, mejor valoradas, A-Z) y los botones **Estrenos** (estrenadas en los últimos 12 meses) y **Recién llegadas**. El buscador también encuentra por reparto.
- **«Recién llegada»** (cinta roja, estilo Netflix): títulos de este año añadidos a la biblioteca en el último mes.
- Cada título guarda el día en que se añadió (`addedAt`), desde que se publica con esta versión del administrador; los que ya estaban no salen como recién llegados. Las plataformas y la fecha de estreno se rellenan al buscar un título en TMDB y con «Actualizar el top y las plataformas con TMDB» (también automático una vez al día al abrir Pelis y series en el administrador).
- «Leer carpetas de LuluStream» guarda como día de llegada (`addedAt`) el día en que LuluStream recibió cada vídeo (`uploaded`); una serie toma el de su primer capítulo. Así los títulos que ya estaban también salen como «Recién llegada» si son de este año y se subieron en el último mes, en cuanto se vuelven a leer las carpetas.

## Imágenes PNG con transparencia (2.20.39)

- Al subir una portada, logo o fondo desde el administrador (web y app), las imágenes con partes transparentes (PNG o WebP) se guardan como PNG (o WebP si el PNG pasa del tamaño permitido, reduciéndolas si hace falta). Antes se convertían siempre a JPEG, que no admite transparencia, y lo transparente salía negro. Las fotos sin transparencia siguen en JPEG.
- En la web, los logos de las tarjetas tienen una sombra que sigue el dibujo en lugar de un cuadrado oscuro detrás.
- Las vistas previas de los enlaces compartidos (WhatsApp) ponen el verde oscuro de las tarjetas detrás de las portadas transparentes, no negro.
- Las imágenes ya subidas como JPEG conservan su fondo negro: hay que volver a subirlas.

## Filas de ligas solo con los eventos de esta semana (2.20.40)

- En la portada (web y app), las filas de cada liga muestran solo sus eventos de **esta semana** (lunes a domingo, hora de Madrid); una liga cuyos próximos partidos son dentro de dos semanas no aparece todavía. Los eventos sin liga o sin fecha siguen saliendo, y un partido de la semana anterior que sigue en juego también. Los demás siguen abriéndose por su enlace y en el buscador.

## Orden de las filas de ligas y canal del evento desde su página (2.20.41)

- En el administrador, **Ligas** tiene «Orden de las filas en la portada»: arrastra ⠿ (o usa las flechas del teclado) y pulsa «Guardar orden». La portada de la web y de la app sigue ese orden (`leagueOrder`); las ligas que no están en la lista van detrás en su orden de siempre y «Otros eventos» sigue al final. Solo salen las ligas con eventos esta semana.
- Si entras como administrador en un evento (web), al final de la página aparece **Administración** con el botón «Seleccionar canal»: abre un buscador por nombre con tus canales y los de TDT, y al elegir uno se publica el evento (manual o importado) con ese canal. Los demás usuarios no ven este bloque.

## Reproducción automática al entrar por un enlace (web)

- Al abrir el enlace de un canal o evento, el reproductor de la web empieza solo. Si el navegador no deja reproducir con sonido porque aún no has tocado la página, el vídeo arranca **sin sonido** y aparece el botón «Activar sonido» arriba a la izquierda; con un toque vuelve el sonido. Antes salía «Pulsa ▶ para empezar».
- Ese silencio automático no se guarda como preferencia: tu volumen y el botón de silencio se siguen recordando como siempre.

## Películas y series al estilo Netflix y «Especial Halloween» (2.20.42)

- **Películas**, **Series** y **Documentales** (web y app) se ven como en Netflix: título grande, «Todas las categorías» y filas: *Películas españolas* (país de producción en TMDB), *Recomendaciones de hoy para ti* (cambian cada día y dan prioridad a los géneros que ya has visto), *Las 10 … más populares de la semana* (números grandes), *Películas de terror*, *Novedades en Calamar TV* (pósteres grandes, desde la 2.20.43), *Seguir viendo para (tu nombre)*, *Ciencia ficción y fantasía*, *¿Quieres echarte unas risas?*, *Thrillers que te mantendrán en vilo* y el resto de géneros.
- Los pósteres llevan la etiqueta roja **TOP 10** en la esquina si están en el top de la semana y **Recién llegada** abajo.
- Al elegir una categoría, buscar o usar «Buscar y filtrar» (año, plataforma, estrenos, recién llegadas, orden) se ve la cuadrícula de resultados como antes.
- El país y el idioma se guardan al añadir un título y se rellenan en los que ya estaban con «Actualizar el top y las plataformas con TMDB» (también automático una vez al día al abrir Pelis y series en el administrador). Hasta entonces, *Películas españolas* no sale.
- Del 1 de octubre al 2 de noviembre (hora de Madrid) la portada tiene **Especial Halloween**: un banner oscuro con todas las películas, series y documentales del género *Terror* y el botón **Descubrir todo**, que abre una página con todo el contenido de terror (en la web, `#/halloween`).

## Slider, plataformas y «Nuevo episodio» en Películas, Series y Documentales (2.20.43)

- Arriba de cada sección (web y app) hay un **slider** como el de Disney+: primero las novedades (recién llegadas y series con capítulo nuevo) y después el top de la semana; pasa solo cada seis segundos y se puede deslizar. En el móvil se ve el póster y en pantallas anchas la imagen de fondo.
- Debajo, **botones con el logo de cada plataforma** (Netflix, Disney+, Prime Video…, según TMDB en España). Cada uno abre la página de esa plataforma (`#/plataforma/Netflix` en la web) con todo su contenido de películas, series y documentales: una portada con el logo sobre la imagen de una de sus películas o series, elegida al azar cada vez, y filas *En primer plano*, por sección y por género.
- **Novedades en Calamar TV**, con los pósteres grandes, ocupa el sitio de *Solo en Calamar TV* y muestra las recién llegadas y las series con capítulo nuevo.
- **Nuevo episodio**: cada capítulo guarda el día en que llegó (al publicarlo o, con «Leer carpetas de LuluStream», el día en que LuluStream lo recibió). Una serie que ya estaba y recibe un capítulo lleva la etiqueta roja «Nuevo episodio» durante dos semanas. Los capítulos que ya estaban antes de esta versión no cuentan.
- Los logos de las plataformas se guardan al añadir un título y en los demás con «Actualizar el top y las plataformas con TMDB» (o la actualización automática diaria). Hasta entonces, el botón muestra el nombre de la plataforma.

## LuluStream en luluvido.com (2.20.44)

- LuluStream cambió su web a **luluvido.com** (lulustream.com ya no responde, error 521); los vídeos, los códigos y la API son los mismos.
- La web, la app y `calamar-lulu.php` abren ahora la página de cada vídeo en `https://luluvido.com/e/CÓDIGO` y llaman a la API en `https://luluvido.com/api/`, con `lulustream.com` como respaldo. Los enlaces ya guardados (lulustream.com, luluvdo.com, lulu.st…) siguen valiendo: se reconocen por el código.
- Los enlaces guardados se cambian a `https://luluvido.com/CÓDIGO`: con el botón **«Cambiar los enlaces a luluvido.com»** (Administración → Pelis y series, junto a «Leer carpetas de LuluStream») de una vez, y en cada publicación los que se peguen con otro nombre.
- **Hay que volver a subir `hosting/calamar-lulu.php` al hosting** (junto a los demás PHP de Calamar TV): es el que lee las páginas de LuluStream para reproducir en la web y lee las carpetas en el administrador.

## Terror con el banner de Halloween y plataformas desde el administrador (2.20.44)

- En Películas, Series y Documentales (web y app), la fila de **terror** tiene el diseño del «Especial Halloween»: banner oscuro con los títulos y **Descubrir todo**, que muestra todos los títulos de terror de esa sección.
- **Administración → Pelis y series → Plataformas**: lista de las plataformas de tus títulos (según TMDB) para **ordenar** los botones (arrastrando ⠿), **subir un logo propio** o pegar su enlace (mejor PNG cuadrado y transparente de unos 256×256; sin logo propio se usa el de TMDB) y **ocultar** los que no quieras (por ejemplo «Amazon Prime Video with Ads»). Se guarda en el catálogo (`platforms`) y lo usan la web y la app.
- Los logos de TMDB aparecen después de pulsar «Actualizar el top y las plataformas con TMDB».

## Ficha de película o serie al estilo Netflix, tráiler y similares (2.20.45)

- La página de cada película, serie o documental (web y app) se ve como en Netflix:
  - Imagen de fondo arriba, la plataforma en rojo (NETFLIX…), el título y sus datos (año, temporadas o duración, nota).
  - Un botón blanco grande **Reproducir**: en las series, el capítulo que dejaste a medias (o el primero), con «Continuar T1:E3 · 12:34».
  - La sinopsis, **Protagonizada por** (los tres primeros y «más» para ver todo el reparto), **Creada por** (series) o **Dirigida por** (películas), los géneros y **Compartir**.
  - Las pestañas **Episodios** (series: desplegable «Temporada N» y cada capítulo con su imagen, «1. Título», su duración y su resumen), **Tráileres y más** y **Similares**.
- **Tráileres y más**: el tráiler en español de TMDB, si lo tiene (primero el de España). En la web se ve dentro de la página; en la app se abre en YouTube.
- **Similares**: títulos de la misma sección que comparten géneros, primero los más parecidos.
- El tráiler, los creadores y la duración de los capítulos se guardan al añadir títulos o temporadas. En los que ya estaban, el tráiler y los creadores llegan con «Actualizar el top y las plataformas con TMDB»; la duración de los capítulos ya guardados, al volver a guardar su temporada.
- **Nuevo episodio** va ahora por la **fecha real de emisión** del capítulo (TMDB), no por el día en que se subió: una serie sale con la etiqueta si tiene en la biblioteca un capítulo emitido en las dos últimas semanas. Una serie antigua subida hoy no la lleva. La fecha llega al guardar la temporada y, para el último capítulo emitido, con la actualización diaria de TMDB.

## Enlaces de AnonMP4 en películas y series (2.20.49)

- Al crear o editar una película, serie o capítulo se puede pegar un enlace de **AnonMP4** (`https://anonmp4.art/v/CÓDIGO`, también `anonmp4.to`, `/embed/…`).
- Se reproduce con **el propio reproductor de AnonMP4**, en su página para incrustar (`embed_url`, la que da su API para otras webs): en la web dentro del reproductor de Calamar TV y en la app a pantalla completa (Atrás para salir). No se saca la dirección del vídeo de su página, que la protege con un permiso firmado.
- Como el reproductor es el de AnonMP4: lleva sus anuncios si los tiene, no se guarda por dónde ibas en «Continuar viendo» y no hay «Saltar intro» ni «Siguiente capítulo» automático.

## «TV» en el menú y fuentes de ZicoTV al final en la app (2.20.50)

- En la app (y antes en la web), la pestaña «Canales» se llama **TV**.
- En la app, los enlaces de **ZicoTV** de un canal van siempre los **últimos**: primero se prueban los enlaces directos de IPTV (M3U8…) y en «Fuentes» salen también primero los vídeos directos y después las páginas de reproductor, con las de ZicoTV al final.

## Más nombres de competiciones al importar (web)

- Los enlaces de Google en español usan nombres como **«Copa de la Liga de Inglaterra»** (Carabao Cup), «Copa de Inglaterra» (FA Cup) o «Primera División de Inglaterra/Italia/Alemania/Francia/Portugal/Países Bajos»: ahora se reconocen al importar una competición por enlace.
