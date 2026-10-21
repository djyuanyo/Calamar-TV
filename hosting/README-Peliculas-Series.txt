PELÍCULAS, SERIES Y DOCUMENTALES · CALAMAR TV

1. Sube calamar-library.php a public_html de calamarmenciano.com, junto a calamar-images.php
   (incluido en este ZIP; si ya lo tienes, no hace falta sustituirlo).
2. Crea una clave gratuita de TMDB: https://www.themoviedb.org/signup → Ajustes → API.
   Sirve la «Clave de la API» (v3) o el «Token de acceso de lectura» (v4).
3. En Calamar TV entra como administrador → Pelis y series → Configuración: TMDB y carpetas.
   Pega la clave y revisa las carpetas (rutas dentro de public_html). Por defecto:
     Películas:    MENCIA MEDIA/PELICULAS
     Series:       MENCIA MEDIA/SERIES
     Documentales: MENCIA MEDIA/DOCUMENTALES
   Pulsa «Guardar configuración». La clave se guarda solo en el hosting, fuera de public_html.
4. Pulsa «Escanear carpetas y buscar en TMDB». Los títulos reconocidos reciben sinopsis, géneros,
   reparto, valoración y carátulas. Los «Sin reconocer» se buscan a mano con «Buscar».
5. Activa «Mostrar Películas, Series y Documentales a los usuarios» para que aparezcan en el menú.

Cómo se leen las carpetas (como Plex):
- Películas y documentales: cada vídeo es un título. Si está solo en su carpeta, el título sale
  de la carpeta: «Avatar (2009)/Avatar.mkv». Se quitan etiquetas como [HDTV 720p][AC3 5.1].
- Series: cada subcarpeta de Series es una serie; cada vídeo dentro (también en subcarpetas
  «Temporada 1») es un capítulo. 1x01, S01E01 o Cap.101 / Cap.1001 dan temporada y capítulo.
- Vuelve a escanear cuando añadas o quites archivos. Las elecciones hechas a mano se conservan.

Los vídeos MKV/AVI se reproducen en la web a través de calamar-video.php (sonido adaptado).
Los datos e imágenes proceden de TMDB; TMDB no respalda ni certifica Calamar TV.
