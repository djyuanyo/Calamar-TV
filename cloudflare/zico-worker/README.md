# Calamar TV: prueba de Zico desde Cloudflare

Worker independiente de la web y de la APK. Resuelve exclusivamente páginas públicas de Zico con `ZT_SOURCES`, sin ejecutar JavaScript del proveedor. Permite consultar eventos públicos y retransmitir HLS con URLs firmadas. No modifica DNS, el hosting ni la app. No elimina autenticación, DRM ni restricciones premium, y no garantiza que Zico acepte peticiones de Cloudflare.

## Desplegar desde tu navegador

1. En Cloudflare, entra en **Workers & Pages → Create application → Import a repository** (los rótulos pueden variar según el idioma).
2. Selecciona `djyuanyo/Calamar-TV` y la rama que contiene esta carpeta.
3. Configura:

| Campo | Valor |
| --- | --- |
| Nombre | `calamar-zico` |
| Directorio raíz | `cloudflare/zico-worker` |
| Comando de compilación | `npm ci && npm test` |
| Comando de despliegue | `npx wrangler deploy` |

4. Despliega. En **Settings → Variables and Secrets**, añade dos secretos diferentes: `ADMIN_TOKEN` y `RELAY_SECRET`, cada uno con al menos 32 caracteres aleatorios. Puedes generarlos con tu gestor de contraseñas. No los publiques en GitHub ni los envíes por chat. `ADMIN_TOKEN` se usa solo para el diagnóstico privado; no se debe incluir en una APK distribuida.
5. Abre la URL `https://calamar-zico.<tu-subdominio>.workers.dev` que muestre Cloudflare. Introduce `ADMIN_TOKEN` en la pantalla de prueba, conserva `https://zicotv.cc/api/player/4` y pulsa **Comprobar**.
6. Copia el informe resultante o envía una captura. El informe omite tokens de las URLs de vídeo. Para continuar basta con compartir la URL pública del Worker y el informe; no compartas las claves.

La integración con Git de Cloudflare debe tener acceso al repositorio. No hace falta crear ni compartir un token de la API de Cloudflare. No contrates un plan de pago para esta prueba sin revisar antes sus condiciones y costes.

## Interpretar la prueba

- `page` / `player`: la página o API responde y publica fuentes; un `403` aquí significa que no se ha llegado al M3U8.
- `extract`: la página responde, pero no expone una lista JSON pública `ZT_SOURCES` con M3U8 disponibles. No se ejecuta ni se intenta saltar un desafío del proveedor.
- `host`: el informe indica un hostname externo no permitido. Antes de añadirlo a `MEDIA_HOSTS` en `wrangler.jsonc`, verifica que sea un CDN público del vídeo. La lista admite nombres exactos separados por comas, nunca IPs ni comodines. No añadas dominios privados o internos. Los cambios en esta variable deben hacerse en el archivo para conservarlos tras los despliegues de Git.
- `playlist`: Cloudflare recibe una lista HLS válida y valida que las referencias (variantes, claves, subtítulos y fragmentos) pertenezcan a hosts permitidos.
- `segment`: Cloudflare recibe bytes del primer fragmento; el informe muestra su estado y tamaño. Esto **no verifica la decodificación, las claves de cifrado, la continuidad ni la reproducción en Android**.

Solo tras validar la ruta remota se debe conectar la APK. La app actual sigue usando la ruta directa. Todavía no se ha añadido un proveedor de sesiones para usuarios de la app: no se debe distribuir `ADMIN_TOKEN` con ella ni abrir `/resolve` sin autenticación.

## Rutas y protección

- `GET /`: formulario privado de diagnóstico; no guarda la clave en almacenamiento ni la URL.
- `GET /health`: estado básico de configuración, sin secretos.
- `GET /diagnose?page=…`: diagnóstico por etapas, con cabecera `Authorization: Bearer ADMIN_TOKEN`.
- `GET /resolve?page=…`: fuentes públicas de un evento o listas firmadas del reproductor, con la misma autenticación.
- `GET /media?data=…&sig=…`: lista o fragmento firmado con HMAC-SHA256, válido durante diez minutos. Las listas reescriben las variantes, claves y fragmentos para que también pasen por el Worker. Las claves HLS y URLs con token no se registran intencionalmente en logs del Worker; los enlaces firmados deben tratarse como credenciales temporales y no compartirse.

Los destinos se validan en cada salto de red. No es un proxy de URLs arbitrarias. La falta de secretos bloquea todas las rutas de red. Los permisos del CDN y sus nombres DNS siguen bajo control del proveedor; usa solo hosts públicos verificados. Un 403 del proveedor se devuelve sin intentar evadir su protección.

## Desarrollo local

Requiere Node.js 22 o posterior.

```sh
cd cloudflare/zico-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

Las pruebas usan respuestas simuladas. Para desarrollo local, los secretos van en `.dev.vars`, que está excluido de Git. Para retirar la prueba, elimina el Worker desde Cloudflare; la web y la app no dependen de él.

Consulta las condiciones del servicio antes de retransmitir vídeo de forma continua. La CDN normal de Cloudflare tiene restricciones para vídeo de terceros; este Worker de diagnóstico no acredita que un plan concreto permita el uso en producción.

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://www.cloudflare.com/service-specific-terms-application-services/
