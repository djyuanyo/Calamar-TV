# Calamar TV · Android y Android TV

App nativa independiente, con identidad Calamar TV e inspiración visual en plataformas deportivas: portada con evento destacado, carruseles con imágenes y escudos, filtros por deporte, directos, agenda por días y canales. Navegación táctil y con foco visible para mando. No utiliza marcas ni recursos de DAZN.

## Instalación y compilación

Requiere Android 5.0 o posterior. En Android TV aparece en el lanzador de TV.

Para compilar: JDK 17, Gradle 8.9 y Android SDK 35. Abrir esta carpeta en Android Studio o ejecutar `gradle :app:assembleDebug` desde aquí. La APK se genera en `app/build/outputs/apk/debug/`.

El workflow **Calamar TV · APK Android y TV** compila esta carpeta en GitHub Actions y publica la APK como artefacto descargable en cada ejecución. Funciona por cambios en esta carpeta o manualmente desde Actions. Este repositorio contiene exclusivamente la app nativa Calamar TV.

## API y reproducción

Datos: `https://bp.zicotv.cc/api/v1/events`. Horas mostradas en Europe/Madrid. Actualización cada 60 segundos mientras la app está activa. La agenda se agrupa por fecha y se ordena por hora; Inicio prioriza directos y próximos encuentros.

Los canales se deduplican a partir de las fuentes `own` presentes en los eventos. La API no documenta un catálogo completo independiente. Las imágenes y escudos proceden de los campos de los eventos. Si fallan, se mantiene el fondo de la tarjeta y sus textos.

La reproducción usa Media3 ExoPlayer (HLS, DASH y vídeo directo). Al abrir una fuente se consulta de nuevo su página HTTPS y se leen las fuentes publicadas (`ZT_SOURCES` o etiquetas HTML de vídeo). El enlace temporal se mantiene en memoria y no se guarda en GitHub ni en la caché del catálogo. El modo web permite detectar solicitudes de vídeo compatibles cuando la página necesita JavaScript.

Hay controles nativos, selector de CDN, renovación manual y reintentos automáticos limitados. Si la URL publica una marca de caducidad reconocible, se vuelve a consultar la página unos 30 segundos antes. Una URL directa sin página de origen no permite obtener un token nuevo. La renovación puede producir una breve reconexión al directo; no se promete continuidad sin cortes.

Se omiten fuentes marcadas como bloqueadas. No se incluyen credenciales de clientes ni se modifican firmas o comprobaciones TLS. Algunas fuentes pueden depender de cookies, DRM o lógica específica del proveedor y requerir el modo web o navegador. El botón Chrome / navegador abre exactamente la misma página de origen.


## Firma de futuras actualizaciones

Las APK debug de CI son para pruebas. Su certificado puede cambiar entre máquinas/ejecuciones. Para actualizar una instalación conservando sus datos, todas las versiones deben usar la misma clave.

El workflow admite firma release mediante estos secretos de GitHub: `CALAMAR_KEYSTORE_BASE64`, `CALAMAR_KEYSTORE_PASSWORD`, `CALAMAR_KEY_ALIAS` y `CALAMAR_KEY_PASSWORD`. La clave de la APK entregada se conserva fuera del repositorio y no se sube a Git. Configurar esos secretos con esa misma clave para distribuir actualizaciones compatibles. No incluir claves ni contraseñas en el código.

## Validación

La APK 1.1.0 se ha compilado con Android API 35, convertido a DEX y firmado con comprobación criptográfica. El manifiesto declara móvil y Android TV y no requiere pantalla táctil. La ejecución en dispositivo, el foco del mando y la reproducción de terceros requieren prueba real. El workflow añade Android Lint a las compilaciones con Gradle.

## Contenido y caché desde 1.2.0

La app incluye una captura real de 369 eventos y 62 canales de la API, fechada el 15/10/2026. Se muestra inmediatamente al instalar, mientras se solicita la agenda actual. Los estados del contenido inicial o guardado se identifican como pendientes de actualización; no se presentan como confirmaciones en vivo.

Cada descarga válida se guarda en el almacenamiento privado. Si falla la conexión o el servidor devuelve una respuesta inválida, se mantienen los datos disponibles y se muestra el motivo. El catálogo de canales propios se conserva aunque una respuesta válida no contenga eventos. Los canales detectados pueden dejar de estar disponibles en el proveedor. No se incluye un catálogo de canales obtenido de otra API.

Validación adicional: seis pruebas sobre deduplicación de canales, conservación del catálogo con agenda vacía, actualización de metadatos, guardado/lectura de caché y rechazo de respuestas inválidas. GitHub Actions ejecuta también las pruebas de datos.

## Reproducción nativa desde 1.3.0

La pantalla de reproducción es una actividad independiente. ExoPlayer se libera al salir o pasar al fondo; al volver se consulta una fuente vigente. Las consultas usan el transporte HTTPS de Android, distinto de WebView. Las respuestas que llegan después de cerrar, cambiar al modo web o iniciar otra consulta se descartan.

La detección inicial de fuentes y su renovación tienen 8 pruebas unitarias adicionales (18 en total). Las pruebas y la compilación no sustituyen la comprobación de reproducción en el móvil/TV y red del usuario. El caso observado era `ERR_CONNECTION_RESET` en WebView, mientras Chrome reproducía la misma ruta sin VPN; el resultado de este nuevo transporte debe confirmarse allí.
