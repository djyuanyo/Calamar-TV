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

# Vídeos MKV/AVI (retirado del hosting)

La conversión de vídeos en el hosting (`calamar-video.php`) se ha retirado: sobrecargaba el servidor. Si
sigue subida, bórrala junto con la carpeta `public_html/calamar-video-cache`. Las películas y series están
ahora en Google Drive: la app reproduce los MKV con sonido; para la web conviene subir MP4 (H.264 + AAC).
`herramientas/convertir-mkv-a-mp4.bat` los convierte en el ordenador con FFmpeg.

## LuluStream

Subir `calamar-lulu.php` al `public_html`. Hace tres cosas:

- Relaya la lista de carpetas de LuluStream para «Leer carpetas de LuluStream» de la administración cuando el
  navegador no puede llamar a la API directamente (solo JSON, unos pocos KB; la clave no se guarda).
- Hace llegar los vídeos de LuluStream al reproductor de la web. LuluStream ata cada dirección de vídeo a la
  IP que abrió su página (403 para cualquier otra), así que el hosting lee la página y pasa la lista HLS y sus
  fragmentos al navegador a medida que llegan. No guarda nada en disco, pero cada película vista en la web
  supone 1–2 GB de tráfico del hosting. Para apagarlo, cambia `const LULU_VIDEO_RELAY = true;` a `false` al
  principio del archivo: la web mostrará entonces el reproductor de LuluStream. La app Android no lo usa.
- `calamar-lulu.php?code=CÓDIGO&debug=1` muestra qué contiene la página del reproductor, para diagnosticar.

Crea `calamar-lulu-secret.php` en la carpeta superior a `public_html` (firma las direcciones que relaya, para
que no se pueda usar como proxy de otras webs). No lo compartas.
