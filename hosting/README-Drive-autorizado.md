# Lectura autorizada de Google Drive

Calamar puede leer archivos ya publicados en su catálogo con una cuenta de servicio de Google Drive. La opción es independiente de la clave que usa la importación de carpetas y no necesita una nueva versión de la app. El puente mantiene la lectura pública como respaldo. El permiso de lectura de Google y sus límites siguen aplicándose.

## Prueba con un capítulo

1. Crea una cuenta de servicio dedicada en un proyecto de Google Cloud con la API de Google Drive habilitada. Comparte con esa cuenta, como **Lector**, únicamente el capítulo de prueba.
2. En el JSON de la cuenta de servicio, añade `"calamar_files": ["ID_DEL_ARCHIVO"]`. Conserva sus campos originales.
3. Guarda el JSON con el nombre `calamar-drive-service.json` en el directorio padre de `public_html`, con permisos `0600`. El JSON contiene una clave privada. No lo publiques en GitHub ni en un directorio público del hosting.
4. Comprueba `calamar-drive.php?status=1`. El campo `drive_authorized` indica que el puente reconoce la configuración. Prueba el capítulo en Calamar, tanto al principio como al adelantar.

Una vez verificado el capítulo, puedes añadir otros IDs en `calamar_files` o autorizar sus carpetas con `"calamar_folders": ["ID_DE_LA_CARPETA"]`. Comparte esas carpetas con la misma cuenta de servicio. La lectura autorizada solo se aplica a enlaces de vídeo firmados de Calamar y archivos incluidos en la configuración. El puente lee el original de Drive por streaming y mantiene la caché temporal del modo compatible para los fragmentos convertidos.

Para volver al modo público, mueve el JSON fuera de la ruta indicada y retira en Drive los permisos de la cuenta de servicio.
