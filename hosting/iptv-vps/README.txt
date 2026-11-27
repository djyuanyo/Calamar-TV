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
La APK intenta abrir la señal original del proveedor con una cuenta verificada. Cuando
esa señal falla o no está disponible, puede usar el enlace HLS. La web usa HTTPS y
el enlace original no se publica en el catálogo de canales.
Si ya instalaste IPTV, ejecuta update.sh del paquete de actualización en el VPS. El
instalador de actualización trabaja con el registro existente de 1.655 señales.

La reproducción de cada canal pone en marcha el servicio HLS. El VPS comparte una sola
conexión al proveedor por canal y la cierra cuando deja de haber espectadores.
Conserva el vídeo H.264 de hasta 1080p y el audio AAC cuando son compatibles. Si el
vídeo requiere conversión, la salida es de hasta 720p a 30 fps.
El servicio funciona sin cupos configurados de espectadores ni de canales simultáneos.
La capacidad real depende de la CPU, el ancho de banda del VPS y las conexiones que admita
el proveedor. En el VPS de 4 vCPU se reserva CPU para los demás servicios limitando este
servicio IPTV a un máximo equivalente a 3 vCPU.

Respaldo opcional en el hosting

1. Actualiza calamar-tv-relay.php en calamarmenciano.com. Necesita calamar-http-source.php
   y calamar-iptv-xtream.php, que ya forman parte de Calamar TV.
2. Instala la actualización de IPTV en IONOS durante una ventana sin emisiones en uso.
   El instalador reinicia el servicio HLS. La detección de carga funciona después del reinicio.
3. Crea overflow.json en la carpeta privada calamar-iptv-private, fuera de public_html.
   Usa maxViewers para reservar conexiones PHP del plan. Comienza por dos y prueba con
   una señal por separado. Usa como clave la ruta de 32 caracteres de su enlace IONOS.

   {"maxViewers":2,"sources":{"0123456789abcdef0123456789abcdef":"https://origen.example/canal.ts"}}

   Usa una señal MPEG-TS que el hosting pueda abrir directamente y que haya funcionado
   a la vez que IONOS. Dos conexiones a una cuenta limitada a una pueden cortarse.
   El código de acceso de la señal y overflow.json se guardan fuera de la web pública.

Cada reproducción nueva consulta el hosting una vez por fuente. El VPS indica presión
después de tres muestras de dos segundos a partir del 75 % de la CPU disponible del
sistema o del cupo de IPTV. Vuelve a admitir conexiones normalmente después de ocho
muestras consecutivas al 60 % o menos. El hosting también admite nuevas conexiones
para estas señales si IONOS deja de responder. Si falta la configuración de un canal
o el hosting agota sus conexiones, se mantiene la ruta habitual.

Prueba un canal que requiera VPN con el dispositivo conectado de forma habitual. El VPS
debe poder abrir la emisión desde su IP para entregar el vídeo.
