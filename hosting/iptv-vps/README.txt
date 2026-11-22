Calamar TV · IPTV en el VPS IONOS

El paquete contiene el servicio y los 1.655 enlaces del catálogo.
sources.json contiene los accesos originales del proveedor. Guarda el ZIP en privado.

1. Sube el ZIP por SCP al VPS desde tu ordenador, en la carpeta donde lo descargaste.

   scp Calamar-IPTV-VPS.zip root@video.calamarmenciano.com:/root/
   ssh root@video.calamarmenciano.com

2. En la terminal del VPS, extrae el ZIP e instala el servicio.

   cd /root
   umask 077
   unzip -o Calamar-IPTV-VPS.zip -d canal-iptv-vps
   bash canal-iptv-vps/install.sh

3. Abre canales-vps.m3u para localizar la URL HTTPS del canal. Pégala en «Enlaces» al crear
   o editar el canal en Administración de Calamar TV. La misma URL sirve para web,
   Android, Android TV y aplicaciones IPTV compatibles con HLS.

Para añadir nuevos enlaces IPTV MPEG-TS, pégalos directamente en «Enlaces» y guarda.
Administración registra la señal en el VPS con tu sesión de Google y guarda su enlace HLS.
Si ya instalaste IPTV, ejecuta update.sh del paquete de actualización en el VPS. El
instalador de actualización trabaja con el registro existente de 1.655 señales.

La primera visita de cada canal pone en marcha la conversión. El VPS comparte una sola
conexión al proveedor por canal y la cierra cuando deja de haber espectadores.
El servicio funciona sin cupos configurados de espectadores ni de canales simultáneos.
La capacidad real depende de la CPU, el ancho de banda del VPS y las conexiones que admita
el proveedor. La salida es de hasta 720 líneas de altura a 30 fps.

Prueba un canal que requiera VPN con el dispositivo conectado de forma habitual. El VPS
debe poder abrir la emisión desde su IP para entregar el vídeo.
