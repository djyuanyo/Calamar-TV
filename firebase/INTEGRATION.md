# Firebase de Calamar TV

Proyecto existente: **MenciaMediaTV** (`menciamedia`, número `1038892679964`). Google habilitado; dominio `djyuanyo.github.io` autorizado. Aplicaciones separadas Calamar TV Web y Android/TV registradas. Android usa `es.yuanyo.calamartv`, con SHA-1 y SHA-256 del certificado de distribución.

Firestore Standard: `(default)`, Madrid (`europe-southwest1`), plan Spark. El documento público `calamarCatalog/custom` contiene `json` (formato de `data/custom.json`), `revision` incremental y `updatedAt` de servidor. Las reglas permiten obtener ese documento, sin listado, y escribir solo a `juanjocarrillo7@gmail.com` mediante Google con correo verificado. El resto de rutas conserva el cierre inicial.

Películas, series y documentales: el editor web lee las carpetas de Google Drive (Drive API con la clave pública del proyecto; hay que tener activada la «Google Drive API» en Google Cloud) y TMDB desde el navegador, y publica la biblioteca en `calamarLibrary/index` y partes `calamarLibrary/<sección>-<n>` (campo `json` de hasta 900 KB y `updatedAt` de servidor), de lectura pública sin listado y escritura solo del administrador. La clave de TMDB y los enlaces de las carpetas están en `calamarPrivate/library`, que solo el administrador puede leer y escribir. No interviene ningún hosting.

El editor web usa Google en una ventana emergente. El editor nativo usa Credential Manager y Firebase Auth. En TV sin estos servicios puede administrarse desde el navegador. La lectura no requiere sesión. Las publicaciones usan transacciones; las listas locales no se importan sin una acción explícita.

Solo se incluyen identificadores públicos de cliente. No se necesitan cuentas de servicio, claves privadas ni secretos OAuth en la APK o en GitHub. La firma de distribución se conserva fuera del repositorio y debe mantenerse en futuras APK.

Pruebas: `npm install && npm test` con Node 24/JDK 21 en este directorio. Se ejecutan sobre `demo-calamar-tv`, aisladas de producción.

Cuentas de usuario y perfiles (web): cualquiera puede entrar con Google o con correo y contraseña (hay que activar «Correo electrónico/contraseña» en Authentication → Método de acceso). Cada cuenta guarda sus perfiles en `calamarUsers/<uid>` (`json` de hasta 20 KB), y cada perfil su lista, «Me gusta» y canales favoritos en `calamarUsers/<uid>/profiles/<perfil>` y su «Continuar viendo» en `calamarUsers/<uid>/progress/<perfil>` (hasta 200 KB). El perfil principal sigue usando `calamarProgress/<uid>`, el que lee la app. Solo la propia cuenta lee y escribe sus documentos; las reglas están en `firestore.rules` y hay que publicarlas en la consola de Firebase.


Acceso web opcional y usuarios (2.20.85): publica primero las reglas actualizadas, antes de desplegar la nueva web. `calamarWeb/access` contiene `requireLogin` (bool) y `updatedAt`; solo lo cambia la cuenta administradora de Google y cualquiera puede leer la política. Si no existe el documento, la web pide una cuenta. `requireLogin:false` restaura la navegación de invitados. La app Android conserva su acceso de invitados. El control limita la navegación de la aplicación web; los archivos públicos de GitHub Pages y los enlaces externos mantienen sus permisos de origen.

`calamarMembers/<uid>` guarda únicamente nombre, email, proveedor, verificación, registro y última conexión; cada cuenta actualiza su propia identidad, contrastada con su token. Solo el administrador lista el directorio. Los perfiles existentes de `calamarUsers` se unen al listado para que los usuarios anteriores también aparezcan; sus datos de identidad se completan cuando vuelven a abrir la web o la nueva app. No se guardan contraseñas ni tokens en este directorio.

`calamarUserAccess/<uid>` conserva el bloqueo de acceso web separado de los perfiles. Solo el administrador lo cambia; la propia cuenta puede leer su estado. Cambiar o borrar un perfil no elimina un bloqueo. El administrador no puede bloquearse a sí mismo. Este panel administra el acceso web y no elimina cuentas de Firebase Authentication.
