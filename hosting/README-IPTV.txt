LISTA IPTV DE CALAMAR TV (WisePlay, TiviMate, IPTV Smarters, VLC…)

1. Abre calamar-iptv-key.php y cambia CAMBIA_ESTA_CLAVE_POR_UNA_LARGA por una clave tuya, larga
   (mínimo 16 letras y números, sin espacios). Ejemplo: Calamar2026xR7tQ9mVb
2. Sube calamar-iptv.php y calamar-iptv-key.php al hosting (la misma carpeta que calamar-lulu.php).
3. En WisePlay: Añadir lista → URL y pega:
      https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE
   Solo canales (sin películas ni series):
      https://calamarmenciano.com/calamar-iptv.php?clave=TU_CLAVE&solo=canales

ENLACE CORTO (para escribirlo con el mando)
Cada usuario tiene un código de 10 letras y números en minúsculas, sin letras que se confundan:
      https://calamarmenciano.com/i/?CODIGO        WisePlay: carpetas, una por serie con su portada
      https://calamarmenciano.com/i/?CODIGO&m3u    otras apps IPTV (M3U)
Sube la carpeta «i» (con su index.php dentro) junto a calamar-iptv.php.

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

Carpetas: las categorías de los canales, «Eventos En Directo», «Películas», «Series» y «Documentales».
- «Eventos En Directo» incluye los eventos del día con un canal o enlace manual compatible con IPTV.
  Cada evento abre su emisión y muestra su portada. Los partidos con escudos pueden mostrar la
  imagen que genera la web. En M3U la categoría aparece cuando hay eventos disponibles.
- Enlace normal (M3U): cada entrada indica si es un directo, una película o un capítulo.
  Los capítulos llevan serie, temporada y número («Serie S01E01 - título»). Los documentales
  individuales se etiquetan como películas y los documentales por capítulos, como series.
  Cada reproductor decide qué etiquetas lee y en qué sección muestra cada título.
- Formato WisePlay (el enlace corto, o &formato=wiseplay): dentro de «Series» una carpeta por serie
  con su portada y, dentro, «Capítulo 1», «Capítulo 2»… (con varias temporadas, una carpeta por
  temporada). Igual en «Documentales». Los canales van todos dentro de la carpeta «Canales», cada
  categoría en su carpeta. En M3U, la categoría «Series» de canales se llama «Cine y ficción TV» para
  evitar que los reproductores la confundan con las series bajo demanda.

INSTALAR EN EL HOSTING E IBO PLAYER
1. Sube calamar-iptv-xtream.php, calamar-iptv-play.php, player_api.php y get.php a public_html.
   Después sustituye calamar-iptv.php en esa misma carpeta. Conserva calamar-iptv-key.php,
   calamar-images.php y la carpeta i. La cuenta PHP debe poder escribir en la carpeta privada
   calamar-iptv-private, que el instalador crea fuera de public_html al recibir una conexión.
2. Edita el .htaccess actual de public_html. Añade el contenido de REGLAS-IPTV-HTACCESS.txt
   antes de # BEGIN WordPress (o al principio si no hay un bloque de WordPress).
3. En Calamar TV → Administración → Lista IPTV, pulsa «Preparar canales en el VPS» para
   registrar las fuentes MPEG-TS compatibles de los canales propios y eventos. El hosting
   guarda las direcciones originales en privado. Las señales ya preparadas usan su URL de IONOS.
4. En Calamar TV → Administración → Usuarios → usuario → Lista IPTV, copia los datos de
   «Copiar acceso Xtream (IBO Player)». En IBO elige una lista Xtream Codes, con servidor
   https://calamarmenciano.com, usuario calamar y la contraseña de la lista de ese usuario.
   La lista antigua M3U/WisePlay sigue sirviendo en las apps que usan ese formato.

Las películas y documentales sueltos aparecen en Películas. Las series y documentales
por episodios aparecen en Series, con las temporadas. El catálogo se actualiza al recargar.

En IPTV, los canales propios registrados en IONOS se sirven en HLS desde el VPS. Los TDT
compatibles usan su enlace directo. El primer espectador inicia la señal en el VPS. Quienes
sintonizan la misma fuente comparten una conexión de entrada y una sesión de FFmpeg. La señal
sigue activa mientras se soliciten segmentos y se detiene tras unos 45 segundos sin peticiones.
Cada espectador recibe su propia copia de los segmentos por la red.
Los vídeos bajo demanda que dependen del conector de Drive, Vidara o LuluStream siguen
usando ese conector. El endpoint IPTV solo redirige: no descarga ni convierte el vídeo.

Las listas personales registran la apertura antes de redirigir al reproductor a la señal.
Las aperturas se ven en las visitas, en el desglose por usuario del contenido y en su historial
como «App IPTV · apertura» (hasta 2.000 por cuenta). La app externa no confirma que reprodujo
ni comunica la duración o el cierre. Estas aperturas no aparecen en el contador de En vivo ahora.

ICONOS DE LAS CARPETAS
Administración → «Lista IPTV»: pega el enlace de una imagen o pulsa «Subir imagen» en cada categoría,
Eventos En Directo, Películas, Series y Documentales, y «Guardar iconos». Se ven en el formato WisePlay; en la lista
M3U solo en las apps que leen «group-logo». Las imágenes subidas van a GitHub como las del catálogo.

Importante:
- No compartas el enlace: algunos canales llevan el usuario y la contraseña del proveedor IPTV, y quien
  tenga la lista ve sin cuenta, sin bloqueo ni límite. Si se filtra, cambia la clave.
- No entran los que solo funcionan dentro de una página (Zico TV, YouTube, Dailymotion, AnonMP4).
- Las películas de LuluStream, Vidara y Drive pasan por el hosting, igual que en la web.
