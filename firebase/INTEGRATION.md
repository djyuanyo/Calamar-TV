# Integración pendiente de conectar Firebase MenciaMediaTV

No desplegar estas reglas antes de leer y conservar las reglas existentes del proyecto. El archivo define únicamente la ruta nueva `/calamarCatalog/custom`.

- Identidad: Firebase Authentication, Google; administración solo para `juanjocarrillo7@gmail.com` con correo verificado y proveedor Google. La autorización se aplica en las reglas, además de la interfaz.
- Catálogo compartido: documento `/calamarCatalog/custom` con `json` (el formato de `data/custom.json`), `revision` incremental y `updatedAt` del servidor. Lectura pública de este documento concreto; sin listado, sin borrado y sin acceso concedido al resto del proyecto.
- Escritura mediante transacciones con revisión esperada para evitar sobrescribir cambios de otro dispositivo.
- Web: sustituir el acceso mediante token de GitHub por Google y leer el catálogo de Firebase con caché local y copia incluida como respaldo. Mantener la web publicada en GitHub Pages.
- Android: añadir Administración con Google, editor del catálogo compartido e importación voluntaria desde Mis canales. Los canales locales no deben publicarse automáticamente. Conservar el DNS seguro y la reproducción de 2.0.1.
- Configuración pendiente: identificador real del proyecto, aplicaciones registradas, configuración pública web/Android, OAuth web client ID, dominios autorizados, SHA-1/SHA-256 de la firma de distribución, estado de Authentication/Firestore y reglas existentes.
- Pruebas antes del despliegue: lectura pública; rechazo de escritura anónima, cuenta distinta, correo no verificado y proveedor distinto; escritura correcta del administrador; rechazo de revisión obsoleta, campos extra y catálogo excesivo.

La configuración está preparada como borrador local; todavía no se ha aplicado al proyecto remoto ni publicado.
