# Puente de MPEG-TS para el alojamiento existente

Subir `calamar-http-source.php` y `calamar-tv-relay.php` al `public_html` de `calamarmenciano.com`.
La web publicada solicita `https://calamarmenciano.com/calamar-tv-relay.php?stream=1`.
El navegador transmite la URL original en `X-Calamar-Source`, nunca en la URL del puente.

Admite flujos HTTP MPEG-TS (`.ts`) y rutas IPTV `/usuario/clave/id`,
`/usuario/clave/id.ts` o `/live/usuario/clave/id.ts`, en distintos servidores públicos
sin añadir cada dominio por separado. Conserva las consultas y tokens tal como llegan.
No sirve páginas web ni convierte cualquier archivo HTTP en un vídeo reproducible.
Las direcciones privadas, locales y reservadas se rechazan; se validan todos los
resultados DNS y cada redirección, y cURL fija la IP validada para evitar cambios DNS.
No se incluye ningún enlace de canal con credenciales.

El puente no impone un cupo de usuarios ni de conexiones simultáneas. Cada conexión
se renueva al alcanzar 120 segundos o 64 MiB. El cliente renueva las conexiones que terminan. No ejecuta FFmpeg,
no convierte HEVC y no guarda los enlaces. La compatibilidad HEVC depende del navegador.
Si el alojamiento impone límites más cortos, el cliente puede necesitar reintentar.

Comprobar después de instalar que la consola del navegador no muestra fallos CORS y
que el vídeo se reproduce desde GitHub Pages. La prueba en el mismo dominio solo
confirma esa primera ruta, no la capacidad de este servicio para muchos espectadores.
Los límites y la admisión de tráfico continuo dependen del plan del alojamiento.

Después de verificar la integración, eliminar los PHP y JavaScript de diagnóstico
`calamar-prueba-7f3c9b.php`, `calamar-video-test-9a62.php`, `calamar-video-test-9a62.js`
y los ZIP subidos al servidor. Conservar el puente, calamar-http-source.php y los archivos de Chromecast que se estén usando.
# Vista previa de eventos al compartir (WhatsApp, Telegram…)

Subir `calamar-evento.php` al `public_html` de `calamarmenciano.com`. Los enlaces que se comparten de un evento
(botón **Compartir** del reproductor, **Copiar enlace** del administrador web y de la app) tienen la forma
`https://calamarmenciano.com/calamar-evento.php?id=ID_DEL_EVENTO`.

WhatsApp y las demás apps no ejecutan JavaScript ni reciben la parte `#/evento/…` de la web, por eso cada evento
necesita esta página: muestra la **foto de portada** y el **nombre del evento** (con liga, fecha y jornada debajo)
y lleva a las personas directamente al evento en la web. Las portadas subidas como foto se sirven desde la misma
página (`&imagen=1`). Lee el documento público del catálogo de Firestore y guarda una copia de 60 segundos en la
carpeta temporal del servidor; no necesita claves ni base de datos. Requiere PHP 8 con cURL o `allow_url_fopen`.

Comprobar después de subirlo: abrir `https://calamarmenciano.com/calamar-evento.php?id=` seguido del id de un evento
(en Admin → Eventos → Copiar enlace) debe llevar al evento. WhatsApp guarda la vista previa de cada enlace durante
un tiempo: si un enlace se compartió antes de subir el archivo, puede seguir mostrando la vista anterior.
