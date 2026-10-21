MARCADOR DE PARTIDOS · CALAMAR TV 2.10.1

1. Descomprime este ZIP en public_html de calamarmenciano.com.
   Deben quedar calamar-match.php y calamar-http-source.php juntos.
   No borres los archivos de vídeo o Chromecast.
2. En Crear/Editar evento, introduce la fecha/hora real del partido y su enlace
   de Compartir de Google (https://share.google/...) o la dirección completa
   https://www.google.com/search?...; pulsa Comprobar partido y guarda.
3. Comprueba que los dos equipos y el partido identificado sean los correctos.

El enlace corto se resuelve una sola vez al guardar. El resultado, estado y minuto
se consultan en ESPN cada 30 segundos desde la web y la APK, sin API de pago.
Solo se pueden vincular partidos de fútbol incluidos en la cobertura de ESPN.
Los datos pueden llevar retraso respecto a la emisión. No se inventan minutos.
Si la fuente falla se muestra Marcador no disponible. Los eventos sin enlace
conservan el estado manual y la fecha/hora de comienzo de antes.

Si Google rechaza un enlace corto, abre ese enlace en Chrome y copia la dirección
completa del partido. El reproductor del canal no depende del marcador.
No necesita FFmpeg ni procesos continuos en el hosting.
