# Prueba Ant Media Server Community — HLS Pull

**Prueba independiente.** No modifica la web, APK, Firebase ni producción. Utilizar únicamente fuentes que puedan reproducirse y redistribuirse legalmente.

## Instalar Community en un VPS Linux

La documentación oficial recomienda instalar Community con el script del proyecto:

```bash
wget https://raw.githubusercontent.com/ant-media/Scripts/master/install_ant-media-server.sh -O install-antmedia.sh
less install-antmedia.sh   # revisar antes de ejecutar como root
chmod 755 install-antmedia.sh
sudo ./install-antmedia.sh
```

Consultar requisitos y compatibilidad antes de instalar, en especial si el VPS ya ejecuta otro servicio web, FFmpeg o Docker. No ejecutar en producción sin respaldo y revisión de puertos.

Documentación: https://docs.antmedia.io/quick-start/

## Crear una fuente HLS

En el panel de administración de Ant Media, seleccionar aplicación `live` > New Live Stream > Stream Source y proporcionar una URL HTTPS `.m3u8` autorizada.

También se puede registrar con su API, tras configurar la seguridad de acceso:

```bash
curl -X POST -H 'Content-Type: application/json' \
  'https://DOMINIO:5443/live/rest/v2/broadcasts/create?autoStart=false' \
  -d '{"type":"streamSource","name":"Prueba HLS autorizada","streamId":"prueba-hls","streamUrl":"https://URL-AUTORIZADA/stream.m3u8"}'
```

Arrancar mediante el panel o:

```bash
curl -X POST 'https://DOMINIO:5443/live/rest/v2/broadcasts/prueba-hls/start'
```

Las llamadas a la API requieren configuración adecuada de seguridad y pueden necesitar autenticación JWT/IP según el despliegue. **No exponer una API sin autenticar.**

## Comprobar HLS

Activar `Create HLS Streaming` en la configuración de la aplicación. Con el stream activo, comprobar desde el panel que realmente llegan segmentos y usar la ruta de reproducción HLS que indique esa instancia (p.ej. `https://DOMINIO:5443/live/streams/prueba-hls.m3u8`, sujeto a configuración).

## Limitación clave

- **VPS propio:** seguirá saliendo tráfico por IONOS para cada espectador; Ant Media no elimina el consumo de red del VPS.
- **Ant Media en servidor externo o CDN:** permite descargar parte o todo ese tráfico del VPS, sujeto a la configuración y al coste del proveedor.
- **AceStream:** Ant Media consume una fuente HLS; no sustituye el motor P2P necesario para obtener un M3U8 a partir de una fuente AceStream.
- Las fuentes de prueba pueden caducar, bloquear hotlinking o dejar de emitir.

Referencias:
- https://docs.antmedia.io/guides/publish-live-stream/ip-camera-and-stream-source/stream-sources/
- https://docs.antmedia.io/guides/playing-live-stream/hls-playing/
- https://docs.antmedia.io/guides/developer-sdk-and-api/rest-api-guide/
