CALAMAR CHROMECAST — instalación en el hosting existente

1. En cPanel > Administrador de archivos, sube y extrae este ZIP en public_html,
   junto a calamar-tv-relay.php (el puente de vídeo que ya funciona).
2. Abre https://calamarmenciano.com/calamar-cast-install.php y pulsa
   «Instalar y comprobar FFmpeg». No cierres la página durante la descarga.
3. En https://calamarmenciano.com/calamar-cast.php debe aparecer «Preparado».
4. Abre el canal HTTP en Calamar TV (web o APK 2.3.1), pulsa Chromecast y elige TV.
   Móvil y TV deben estar en la misma red. La primera preparación tarda unos segundos.
5. Tras instalar, elimina calamar-cast-install.php. Conserva calamar-cast.php,
   calamar-tv-relay.php y la carpeta calamar-cast-bin que habrá creado.

La instalación descarga FFmpeg Linux x86_64 portable del proyecto eugeneware/ffmpeg-static,
verifica el SHA-256 del archivo exacto y le concede permisos de ejecución.
Requiere PHP 8.1+, cURL, exec/shell_exec, flock y permiso del hosting
para ejecutar procesos. No requiere acceso SSH ni root. Si el servidor bloquea
los procesos, la página lo indica: JavaScript y el botón Cast no pueden suplirlo.

El adaptador convierte el canal TS/HEVC del proveedor ya configurado a H.264/AAC
720p25 y HLS por HTTPS. Comparte un conversor por enlace de origen, aunque haya
varios espectadores. El vídeo se guarda en segmentos temporales de unos segundos,
se borra conforme avanza y la conversión se para tras 90 s sin peticiones de la TV.
Los enlaces originales y sus credenciales nunca se incluyen en las URL públicas.
Durante la conversión se usa un script privado en la carpeta temporal, eliminado
al terminar; los medios públicos usan tokens opacos. No publicar esos tokens.

No hay un cupo de espectadores configurado. CPU, procesos simultáneos, disco y
transferencia siguen sujetos a la capacidad y condiciones del hosting contratado.
No se contratan servicios ni se activan pagos, pero no se promete capacidad ilimitada.
La instalación y el envío deben verificarse en el hosting y en un Chromecast real.

Instalador 2: descarga el ejecutable directamente, sin tar ni xz.