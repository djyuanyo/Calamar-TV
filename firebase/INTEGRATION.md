# Firebase de Calamar TV

Proyecto existente: **MenciaMediaTV** (`menciamedia`, número `1038892679964`). Google habilitado; dominio `djyuanyo.github.io` autorizado. Aplicaciones separadas Calamar TV Web y Android/TV registradas. Android usa `es.yuanyo.calamartv`, con SHA-1 y SHA-256 del certificado de distribución.

Firestore Standard: `(default)`, Madrid (`europe-southwest1`), plan Spark. El documento público `calamarCatalog/custom` contiene `json` (formato de `data/custom.json`), `revision` incremental y `updatedAt` de servidor. Las reglas permiten obtener ese documento, sin listado, y escribir solo a `juanjocarrillo7@gmail.com` mediante Google con correo verificado. El resto de rutas conserva el cierre inicial.

El editor web usa Google en una ventana emergente. El editor nativo usa Credential Manager y Firebase Auth. En TV sin estos servicios puede administrarse desde el navegador. La lectura no requiere sesión. Las publicaciones usan transacciones; las listas locales no se importan sin una acción explícita.

Solo se incluyen identificadores públicos de cliente. No se necesitan cuentas de servicio, claves privadas ni secretos OAuth en la APK o en GitHub. La firma de distribución se conserva fuera del repositorio y debe mantenerse en futuras APK.

Pruebas: `npm install && npm test` con Node 24/JDK 21 en este directorio. Se ejecutan sobre `demo-calamar-tv`, aisladas de producción.
