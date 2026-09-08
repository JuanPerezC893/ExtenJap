# Japan-Paw para Hayase — 0.3.6

Repositorio dual: **Japan-Paw Direct** (`torrent.js`) busca metadatos compatibles y **Japan-Paw WebSeed** (`http.js`) aporta el archivo HTTP. El catálogo contiene 3.316 entradas y 83.681 enlaces de episodios/versiones; tener un enlace indexado no significa que exista un torrent compatible.

## Correcciones de esta versión

- La búsqueda valida el archivo `.torrent` descargado, su infoHash, nombre real, tamaño conocido y estructura. El nombre y el peso mostrados proceden de esos metadatos, no de una combinación del catálogo con un torrent diferente.
- El nombre exacto o un CRC acompañado de una coincidencia de título/episodio identifica una versión. Los conflictos de CRC, resolución y codec se rechazan; no se acepta el candidato de mayor puntuación si corresponde a otro archivo.
- No se reintroducen batches cuando la búsqueda solo devuelve paquetes. La fuente Direct utiliza torrents de un único archivo de video, sin límite de tamaño para películas. `movie()` está implementado.
- La fuente HTTP utiliza la misma comparación. En batches externos resuelve cada archivo por separado y conserva su índice; admite episodio cero.
- Una consulta con AniList ID no recae en una serie que tenga otro ID. Se preservan Unicode, alias y correcciones tipográficas únicas. Los IDs existentes no han sido auditados uno por uno.
- Se eliminan los contadores inventados de seeders y descargas. La disponibilidad es **verificada**, **caída** o **sin verificar**, según una comprobación fechada de menos de 24 horas. Los antiguos `isOnline: true` sin fecha no se presentan como verificados.
- La importación y actualización preservan IDs/alias y conservan metadatos solo para la misma URL de archivo. Los vinculadores de Nyaa también validan la identidad antes de guardar un torrent.
- Ambas extensiones comparten lógica y se empaquetan con esbuild. No dependen de la existencia de `TorrentSource` o `WebSeedSource` como variables globales.

## Comandos

Node.js 22 o posterior:

```powershell
npm ci
npm run build
npm test
```

`build` conserva la dirección de alojamiento ya configurada en `dist/manifest.json`. Para cambiarla explícitamente:

```powershell
npm run build -- https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/
```

El resultado queda en `dist/`. Este comando no hace commit ni push. La actualización en Hayase solo estará disponible cuando se publique esa carpeta en el repositorio correspondiente.

### Actualizar datos

```powershell
node scrape.mjs 7901 7901 --refresh
node import-chapters.mjs
node check-links.mjs --series 7901 --episode 1 --resolution 720 --limit 1
npm run build
```

El scraper usa por defecto una petición concurrente y una pausa de un segundo. Los errores de acceso no prueban que una serie no exista. El script alternativo `scrape_update.py` requiere sus dependencias de Python y trabaja con la configuración de proxies que ya tenía el proyecto.

`check-links` hace una petición Range de un byte y registra fecha y estado. Un bloqueo o error de red queda como desconocido. No se han comprobado masivamente todos los enlaces.

### Cuando no existe el torrent exacto

No se puede sustituir un archivo JPN por otro MULTi ni un encode por otro, aunque sean el mismo capítulo y resolución. Para un archivo sin metadatos compatibles sigue disponible el generador local:

```powershell
node hash.mjs --series 7901 --episode 1 --resolution 720 --limit 1 --max-bytes 2000000000
npm run build
```

Ese comando lee el video completo una vez; no forma parte de las búsquedas normales. `--max-bytes` limita la transferencia de esa ejecución, no el tamaño permitido por la extensión. Guarda los metadatos en el catálogo de origen y en `dist` para que el siguiente build los conserve.

## Validación

`npm test` ejecuta pruebas con aserciones, sin consultar servicios externos. Cubre archivos incorrectos, CRC contradictorio, resoluciones, episodios 1–12 de Mashle S2, episodio cero, películas grandes, batches, caché del catálogo, filtros, actualización de datos y carga de los bundles sin módulos externos. También incluye una descarga HTTP local cuyas piezas se verifican contra el torrent.

Para una prueba de red explícita:

```powershell
node verify-live.mjs
node verify-live.mjs --pieces
```

Con `--pieces` se comprueban primera y última pieza por SHA-1; no se descarga el video entero. El comando devuelve código distinto de cero si alguno de los casos no tiene un torrent compatible.

Comprobaciones reales durante esta corrección:

- **Mashle S2, episodio 2, 1080p y 720p:** metadatos distintos y correctos; primera y última pieza HTTP coinciden por SHA-1 en ambas versiones.
- **Sayonara Lara, episodio 1, 1080p y 720p:** mismas comprobaciones correctas.
- **Barbaroi, episodio 2:** la versión JPN de Japan-Paw tiene 1.494.912.099 bytes; el torrent MULTi que antes se mostraba tiene 1.802.888.724 bytes. Se rechaza. No se encontró una coincidencia exacta en las consultas realizadas.

Estas comprobaciones no equivalen a probar toda la reproducción dentro de Hayase, ni garantizan la disponibilidad futura de los servidores. No se ha modificado la aplicación Hayase ni se ha publicado esta versión automáticamente.
