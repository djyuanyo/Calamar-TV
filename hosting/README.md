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

# Vídeos MKV/AVI del hosting en la web (sonido AC3/DTS)

Subir `calamar-video.php` al `public_html` de `calamarmenciano.com`, junto a `calamar-cast.php` y
`calamar-http-source.php` (usa el FFmpeg que instala `calamar-cast-install.php`). Comprobar en
`https://calamarmenciano.com/calamar-video.php` que dice «Preparado».

Un canal cuyo enlace es un vídeo guardado en este hosting (`.mkv`, `.avi`, `.mov`…) se reproduce en la
web a través de esta página: el vídeo H.264 se copia tal cual (sin recomprimir, poco uso de CPU) y el
audio, a menudo AC3 o DTS que Chrome y Firefox no reproducen, pasa a AAC estéreo. Se entrega en HLS que
crece mientras se convierte: empieza a verse en unos segundos y, al terminar, se puede avanzar a
cualquier punto. Si el vídeo no es H.264 (por ejemplo HEVC), también se convierte la imagen, lo que
cuesta mucha más CPU.

Solo se aceptan archivos dentro de `public_html` de este sitio; nunca enlaces de otros servidores. Cada
vídeo convertido se comparte entre todos los espectadores y se borra tras 6 horas sin uso (ocupa
aproximadamente lo mismo que el original en la carpeta temporal). Como máximo se convierten 2 vídeos a la
vez. La app Android reproduce estos archivos directamente con el decodificador del dispositivo.
