IMÁGENES DE CALAMAR TV EN GITHUB

1. Descomprime este ZIP. Sube calamar-images.php a public_html en tu hosting, junto a los otros archivos calamar-*.php.
2. Abre Calamar TV, inicia sesión como administrador y despliega «Imágenes en GitHub».
3. En GitHub crea una credencial fine-grained en https://github.com/settings/personal-access-tokens/new
   Propietario: djyuanyo. Solo el repositorio Calamar-TV.
   Permiso Repository permissions → Contents → Read and write. No necesita permisos de Workflows.
4. Pega esa credencial en el campo «Credencial de GitHub» del administrador y pulsa «Conectar GitHub».
   Se envía por HTTPS al hosting. No se guarda en Firebase, en la APK ni en el código de GitHub.
   El archivo privado calamar-images-config.php se crea en la carpeta superior a public_html con permisos 0600.
   No compartas ese archivo. Si la credencial caduca, conecta una nueva desde el mismo panel.
5. Pulsa «Guardar catálogo y liberar espacio de las portadas antiguas».
   Las portadas ya trasladadas se sustituyen por sus enlaces, conservando eventos, canales y revisiones.

A partir de entonces, las fotos de eventos, ligas y equipos se guardan en web/images del repositorio.
Los enlaces existentes siguen funcionando. Las imágenes idénticas se reutilizan.
Solo la cuenta de administrador de Google puede autorizar nuevas subidas.

Las imágenes y sus enlaces son públicos, como las portadas del catálogo. El repositorio crece con las fotos que se suben.
Esto utiliza el hosting y GitHub que ya tienes; no configura servicios de pago.

Si aparece «Falta subir calamar-images.php», revisa que el archivo esté en:
https://calamarmenciano.com/calamar-images.php
La comprobación debe devolver JSON con configured: false o true, nunca mostrar la credencial.
