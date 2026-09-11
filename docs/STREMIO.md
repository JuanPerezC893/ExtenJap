# Stremio: Japan-Paw Directo

Este complemento usa raw-catalog.json directamente. No requiere torrents, preindexación ni Drive. El catálogo se carga al iniciar; reinicia el servicio después de actualizarlo con el scraper.

## Iniciar en Windows

Desde la carpeta del proyecto:

```powershell
.\warp-proxy.ps1 start  # Solo si WARP no está iniciado
npm run stremio
```

En Stremio de escritorio, abre Complementos y pega esta URL en la instalación por enlace:

```
http://127.0.0.1:8790/manifest.json
```

También puedes abrir http://127.0.0.1:8790 y pulsar «Instalar en Stremio». Mantén el servicio encendido mientras reproduces. Ctrl+C lo detiene.

Busca en el catálogo **Japan-Paw**, abre una serie, un episodio y selecciona una calidad. Usamos IDs propios: los resultados no se insertan automáticamente en fichas de Cinemeta. Cada entrada del catálogo original conserva su temporada y numeración, presentadas como una temporada independiente. También se muestran las películas como entradas de un episodio porque el catálogo no distingue su tipo de forma fiable.

## Funcionamiento

El reproductor solicita un archivo al servicio local. Este lo transmite a través del proxy configurado en proxies.txt, con memoria acotada por el flujo de lectura. Pasa Range/If-Range y las respuestas 206/416, y cancela la solicitud al cerrar el reproductor. No descarga previamente el archivo completo ni guarda vídeos en disco. No busca torrents, no calcula hashes y no cambia el estado anterior.

Ante 404/410 se consulta una vez la página pública de la serie y solo se sustituye el enlace cuando existe una coincidencia única de nombre de archivo y episodio. Se guarda esa consulta en memoria durante cinco minutos. Los bloqueos 403 y las caídas del proveedor siguen siendo posibles; no se ocultan como vídeos válidos.

El servicio escucha exclusivamente en 127.0.0.1 y solo transmite destinos HTTPS del proveedor incluidos en el catálogo. No sirve como proxy de URLs arbitrarias. Esta versión es para Stremio de escritorio en este PC: un televisor u otro dispositivo no puede acceder a localhost del PC.

Opciones:

```powershell
node stremio.mjs --port 8790 --catalog raw-catalog.json --proxy-file proxies.txt
# Conexión directa opcional, sin WARP:
node stremio.mjs --direct
```

## Verificación realizada

Pruebas automatizadas de catálogo, búsqueda, episodios, calidades, HEAD, rangos, rechazo de HTML y redirecciones fuera del proveedor.

Prueba real con WARP: Dandadan 2nd Season, episodio 1, 1080p. Inicio bytes 0–1048575: HTTP 206, 1.048.576 bytes, cabecera EBML de MKV, unos 3 segundos. Salto bytes 50000000–50065535: HTTP 206, 65.536 bytes, unos 1,1 segundos. Tamaño declarado: 1.483.105.977 bytes. No se descargó el vídeo completo.

Esto verifica el transporte HTTP, no la decodificación audiovisual. Queda por comprobar la reproducción en Stremio, la selección de las pistas de audio/subtítulos incluidas en el MKV y los saltos desde su interfaz. No hay transcodificación ni descarga adicional de subtítulos en este complemento.
