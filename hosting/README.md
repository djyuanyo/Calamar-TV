# Puente de MPEG-TS para el alojamiento existente

Subir `calamar-tv-relay.php` al `public_html` de `calamarmenciano.com`.
La web publicada solicita `https://calamarmenciano.com/calamar-tv-relay.php?stream=1`.
El navegador transmite la URL original en `X-Calamar-Source`, nunca en la URL del puente.

El destino inicial está limitado al servidor HTTP comprobado (`31.43.191.125:8080`)
y a sus rutas `/usuario/clave/id` o `/usuario/clave/id.ts`. Los saltos de redirección
se validan y fijan a IP públicas, manteniendo la comprobación TLS en HTTPS.
No es un proxy de destino libre. No se incluye ningún enlace de canal con credenciales.

La prueba inicial se limita a cuatro conexiones simultáneas, 120 segundos y 64 MiB
por conexión. El cliente renueva las conexiones que terminan. No ejecuta FFmpeg,
no convierte HEVC y no guarda los enlaces. La compatibilidad HEVC depende del navegador.
Si el alojamiento impone límites más cortos, el cliente puede necesitar reintentar.

Comprobar después de instalar que la consola del navegador no muestra fallos CORS y
que el vídeo se reproduce desde GitHub Pages. La prueba en el mismo dominio solo
confirma esa primera ruta, no la capacidad de este servicio para muchos espectadores.
Los límites y la admisión de tráfico continuo dependen del plan del alojamiento.

Después de verificar la integración, eliminar los PHP y JavaScript de diagnóstico
`calamar-prueba-7f3c9b.php`, `calamar-video-test-9a62.php`, `calamar-video-test-9a62.js`
y los ZIP subidos al servidor. Conservar únicamente el puente.
