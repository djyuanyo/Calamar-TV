PELÍCULAS, SERIES Y DOCUMENTALES · CALAMAR TV (vídeos en Google Drive)

1. Sube calamar-library.php a public_html de calamarmenciano.com, junto a calamar-images.php
   (incluido en este ZIP; sustituye los que ya tengas).
2. Activa la API de Google Drive (una sola vez):
   https://console.cloud.google.com/apis/library/drive.googleapis.com?project=menciamedia
   → «Habilitar». Usa la clave pública del proyecto de Firebase; no hay que crear otra.
   (Si prefieres una clave tuya, créala en Google Cloud → Credenciales, limítala a «Google Drive
   API» y pégala en «Clave de Google para Drive».)
3. En Google Drive crea tus carpetas (Películas, Series, Documentales). Botón derecho sobre cada
   una → Compartir → Acceso general: «Cualquier persona con el enlace» (Lector) → Copiar enlace.
4. En Calamar TV entra como administrador → Pelis y series → Configuración: TMDB y carpetas.
   Pega la clave de TMDB (https://www.themoviedb.org → Ajustes → API) y el enlace de cada carpeta
   de Drive. Pulsa «Guardar configuración».
5. Pulsa «Escanear carpetas y buscar en TMDB». Los títulos reconocidos reciben sinopsis, géneros,
   reparto, valoración y carátulas. Los «Sin reconocer» se buscan a mano con «Buscar».
6. Activa «Mostrar Películas, Series y Documentales a los usuarios» para que aparezcan en el menú.

Cómo se leen las carpetas (como Plex, igual que antes):
- Películas y documentales: cada vídeo es un título. Si está solo en su carpeta, el título sale
  de la carpeta: «Avatar (2009)/Avatar.mp4». Se quitan etiquetas como [HDTV 720p][AC3 5.1].
- Series: cada subcarpeta de Series es una serie; cada vídeo dentro (también en subcarpetas
  «Temporada 1») es un capítulo. 1x01, S01E01 o Cap.101 / Cap.1001 dan temporada y capítulo.
- Vuelve a escanear cuando añadas o quites vídeos. Las elecciones hechas a mano se conservan.

Si el hosting se cae: la lista se publica también en GitHub (library/calamar-library.json) con la
credencial de GitHub de Imágenes, y los vídeos se reproducen desde Google Drive, así que todo sigue
viéndose. Solo hace falta el hosting para escanear y buscar en TMDB.

Formatos: la app reproduce MP4 y MKV. En la web, mejor MP4 (vídeo H.264 y audio AAC): los MKV con
audio AC3/DTS pueden verse sin sonido en el navegador.
Google Drive limita las descargas de un archivo muy visto; si un vídeo deja de cargar, espera o
haz una copia del archivo en Drive.
Los datos e imágenes proceden de TMDB; TMDB no respalda ni certifica Calamar TV.
