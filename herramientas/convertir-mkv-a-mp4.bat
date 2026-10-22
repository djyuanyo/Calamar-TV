@echo off
rem Calamar TV: convierte a MP4 los vídeos MKV/AVI de una carpeta (y sus subcarpetas) para que se oigan
rem también en el navegador. La imagen se copia tal cual (rápido, sin perder calidad) y el sonido pasa a
rem AAC estéreo. Los MP4 quedan junto a los originales; sube a Google Drive los MP4.
rem
rem Necesita FFmpeg: https://www.gyan.dev/ffmpeg/builds/ (ffmpeg-release-essentials.zip). Descomprímelo
rem y copia ffmpeg.exe junto a este archivo, o añádelo al PATH.
rem
rem Uso: arrastra una carpeta encima de este archivo, o ejecútalo y escribe la ruta.
setlocal enabledelayedexpansion
chcp 65001 >nul
set "FOLDER=%~1"
if "%FOLDER%"=="" set /p "FOLDER=Carpeta con los vídeos: "
if not exist "%FOLDER%" ( echo No existe la carpeta "%FOLDER%". & pause & exit /b 1 )
set "FFMPEG=ffmpeg"
if exist "%~dp0ffmpeg.exe" set "FFMPEG=%~dp0ffmpeg.exe"
for /r "%FOLDER%" %%F in (*.mkv *.avi *.mov *.wmv *.m2ts *.vob *.mpg *.mpeg) do (
  set "OUT=%%~dpnF.mp4"
  if exist "!OUT!" (
    echo Ya existe: !OUT!
  ) else (
    echo Convirtiendo: %%~nxF
    "%FFMPEG%" -hide_banner -loglevel error -i "%%F" -map 0:v:0 -map 0:a:0? -c:v copy -c:a aac -b:a 192k -ac 2 -movflags +faststart "!OUT!"
    if errorlevel 1 (
      echo   La imagen no se puede copiar ^(códec no compatible con MP4^): se recomprime, tardará más.
      "%FFMPEG%" -hide_banner -loglevel error -y -i "%%F" -map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 192k -ac 2 -movflags +faststart "!OUT!"
    )
  )
)
echo.
echo Terminado. Sube los .mp4 a tus carpetas de Google Drive y vuelve a escanear en el admin.
pause
