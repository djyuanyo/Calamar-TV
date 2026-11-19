LISTA IPTV DE CALAMAR TV (WisePlay, TiviMate, IPTV Smarters, VLC…)

1. Abre calamar-iptv-key.php y cambia CAMBIA_ESTA_CLAVE_POR_UNA_LARGA por una clave tuya, larga
   (mínimo 16 letras y números, sin espacios). Ejemplo: Calamar2026xR7tQ9mVb
2. Sube calamar-iptv.php y calamar-iptv-key.php al hosting (la misma carpeta que calamar-lulu.php).
3. En WisePlay: Añadir lista → URL y pega:
      https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE
   Solo canales (sin películas ni series):
      https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE&solo=canales

LISTAS DE CADA USUARIO
En Administración → Usuarios → Editar (un usuario) → «Lista IPTV»:
- «Crear lista» le crea un enlace con una contraseña aleatoria: cópialo y dáselo.
- Pon el último día que funciona (vacío: sin caducidad) y «Guardar caducidad». Al pasar ese día, su
  app IPTV ve «Esta lista de Calamar TV ha caducado».
- «Nueva contraseña» cambia el enlace (el anterior deja de funcionar) y «Borrar lista» lo anula.
- Bloquear o eliminar la cuenta no borra su lista: bórrala también si quieres cortarle el acceso.
Hace falta haber publicado las reglas nuevas de Firestore (firebase/firestore.rules).

La lista se genera de nuevo cada vez que la app la carga o la actualiza: los canales, películas, series
y documentales que cambies en Administración salen solos, sin subir nada más.

Carpetas: las categorías de los canales, «Películas», «Series» y «Documentales».
- Enlace normal (M3U, vale para cualquier app IPTV): una sola carpeta «Series» con todos los
  capítulos («Serie T1 E01 - título»), igual en «Documentales».
- Formato WisePlay: añade &formato=wiseplay al final del enlace. Dentro de «Series» sale una carpeta
  por serie con sus capítulos, y cada carpeta lleva su icono.

ICONOS DE LAS CARPETAS
Administración → «Lista IPTV»: pega el enlace de una imagen o pulsa «Subir imagen» en cada categoría,
Películas, Series y Documentales, y «Guardar iconos». Se ven en el formato WisePlay; en la lista
M3U solo en las apps que leen «group-logo». Las imágenes subidas van a GitHub como las del catálogo.

Importante:
- No compartas el enlace: algunos canales llevan el usuario y la contraseña del proveedor IPTV, y quien
  tenga la lista ve sin cuenta, sin bloqueo ni límite. Si se filtra, cambia la clave.
- No entran los que solo funcionan dentro de una página (Zico TV, YouTube, Dailymotion, AnonMP4).
- Las películas de LuluStream, Vidara y Drive pasan por el hosting, igual que en la web.
