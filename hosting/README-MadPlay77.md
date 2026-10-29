# MadPlay77: borrador de renovación automática

**No desplegado ni verificado con vídeo real.** Las pruebas realizadas el 29-10-2026 desde el hosting obtuvieron las listas HLS de VIX ES y Fubo US, pero sus primeros fragmentos devolvieron 403 sin ofrecer una sesión nueva. El navegador de inspección también fue rechazado por la web. Las pruebas incluidas usan respuestas sintéticas y no acceden al proveedor.

El puente está separado de Zico y deshabilitado por defecto. No cambia la APK, la web publicada, los cambios de audio/subtítulos ni los archivos actuales de reproducción.

## Comportamiento preparado

- Una dirección estable conserva el partido y la fuente: `/calamar-madplay.php/match/4522835/source/905919/index.m3u8`.
- El hosting obtiene la sesión emitida por la API pública. La vuelve a consultar cada minuto y ante una caducidad explícita; no se guarda un M3U8 temporal en el catálogo.
- Tras una renovación, vuelve a leer las listas para actualizar también las firmas de cada fragmento. Mantiene la misma fuente, secuencia, pistas de audio y subtítulos.
- Una sesión de sustitución solo se utiliza si la emite el propio proveedor. No se inventan sesiones ni se deshabilitan comprobaciones TLS.
- Un 403 genérico se comunica como descarga rechazada; no se intenta resolver con renovaciones infinitas. Un fragmento que ya salió de la ventana del directo devuelve 410.
- Listas, listas secundarias, claves y fragmentos pasan por direcciones opacas del hosting. Los secretos y la caché quedan fuera de `public_html`. Los recursos solo proceden de listas entregadas por el proveedor y se limitan a los dominios observados, con DNS público fijado en cada redirección.

## Partido actual para la validación pendiente

El usuario sustituyó el enlace anterior, cuya emisión había terminado, por CSKA Moscú–Lokomotiv Moscú, Copa de Rusia: partido `4436876`. El lector de páginas distingue ese partido del anterior `4522835`. La lectura del ID está cubierta por una prueba sin conexión; no se ha comprobado la señal del nuevo partido.

## Validación pendiente antes de habilitar

Comprobar una lista y fragmentos recientes con datos reales permitidos por el proveedor, reproducción continuada durante varias renovaciones y compatibilidad con el hosting. Después validar el enlace estable en web, móvil y Android TV. Estos resultados no pueden deducirse de las pruebas con respuestas simuladas.

El punto de activación es un archivo privado `calamar-madplay-config.php` un nivel por encima de `public_html`, con `enabled`, una lista entera `matches`, las fuentes permitidas en `sources` (por ejemplo, `[4522835 => [905919, 901559]]`) y `secret` aleatorio de al menos 32 caracteres. No crear ni activar ese archivo hasta completar la validación real. La ausencia del archivo o `enabled=false` devuelve 503 sin hacer peticiones al proveedor.

## Pruebas sin conexión

`php tools/madplay_session_test.php` valida renovación, firma de fragmentos, errores persistentes, recursos caducados, listas con varias pistas y contenido HTML servido con estado 200. `php tools/madplay_provider_test.php` valida la lectura del protocolo con respuestas sintéticas. El workflow `MadPlay77 · Renovación sin conexión` ejecuta ambas; no realiza una prueba de reproducción real.
