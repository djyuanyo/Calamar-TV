# Prueba AceStream → HLS (Calamar TV)

Este director incorpora una **prueba local aislada**, sin modificar los canales, el reproductor, Firebase o las APK existentes. No incluye la lista Wiseplay de terceros ni sus identificadores.

## Requisitos

- Servidor Linux **x86_64** con Docker y Docker Compose.
- Fuente AceStream cuya recepción y distribución estén autorizadas.
- Acceso SSH al servidor; para abrir la API desde tu ordenador, emplea un túnel SSH. **No abras el puerto 6878 al público**.

## Iniciar en el VPS

Desde este director:

```bash
docker compose up -d
docker compose ps
curl -fsS 'http://127.0.0.1:6878/webui/api/service?method=get_version'
```

El servicio escucha exclusivamente en **127.0.0.1:6878**. No se ha configurado ningún proxy HTTPS público.

## Probar un contenido autorizado

Sustituye `ID_AUTORIZADO` por el identificador real que tengas permiso para utilizar:

```bash
curl -I 'http://127.0.0.1:6878/ace/manifest.m3u8?id=ID_AUTORIZADO'
```

Para acceder desde un ordenador remoto, abre en él un túnel:

```bash
ssh -L 6878:127.0.0.1:6878 usuario@IP_DE_TU_VPS
```

Después prueba en VLC, desde ese mismo ordenador:

```text
http://127.0.0.1:6878/ace/manifest.m3u8?id=ID_AUTORIZADO
```

**Importante:** una respuesta HTTP no garantiza que existan pares o vídeo disponible. El manifiesto HLS puede incluir URLs transitorias y la reproducción depende del motor, de la fuente y de su disponibilidad.

## Detener

```bash
docker compose down
```

## Integración posterior con Calamar TV

Esta prueba **no constituye un streaming público listo para producción**. Para integrarlo con la web y las APK habría que estudiar la autenticación, los permisos de distribución, HTTPS, las redirecciones y URLs internas de manifiestos/segmentos, la compatibilidad HLS y la concurrencia. No se debe exponer directamente el motor sin controles de acceso. La capacidad del servidor debe comprobarse con una fuente autorizada y varios clientes.

Documentación: https://docs.acestream.media/developers/start-playback/
Imagen utilizada: https://github.com/martinbjeldbak/acestream-http-proxy
