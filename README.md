# Japan-Paw → Hayase

Continuación del proyecto de la conversación de Claude. Node.js 22 o posterior.

Estado de esta entrega: pruebas automatizadas aprobadas; catálogo de muestra importado; generado el torrent real de Sayonara Lara 01 en 720p (411.795.960 bytes). Se verificaron por HTTP las piezas 1, 197 y 393 contra sus hashes SHA-1. El torrent ocupa 8.308 bytes. La búsqueda del script empaquetado devuelve la entrada y su URL local responde HTTP 200. Queda pendiente validar la reproducción dentro de Hayase.

## Qué se corrigió

La extensión HTTP de Hayase complementa un torrent ya identificado. Este proyecto usa una extensión `torrent` que entrega archivos `.torrent` completos con `url-list` (webseed HTTP). No basta un magnet con `ws=`: faltan los hashes de las piezas y otros metadatos cuando no hay peers que los entreguen.

El hasher lee el archivo completo una vez para calcular las piezas; conserva únicamente los metadatos. Por eso indexar miles de videos puede transferir muchos terabytes. El valor predeterminado es un archivo por ejecución, con un máximo de 2 GiB por archivo. No se ha recorrido todo el sitio.

## Prueba en Windows / PowerShell

```powershell
npm ci
npm test
npm run sample
npm run build
node probe.mjs 7901 1 720
node hash.mjs --series 7901 --episode 1 --resolution 720 --limit 1 --max-bytes 500000000
node verify.mjs 7901 1 720
npm run serve
```

`sample` importa el HTML proporcionado: 20 enlaces (10 episodios × 2 resoluciones). `probe` comprueba soporte Range con una petición de un byte. `hash` descarga el contenido en streaming y genera `dist/torrents/<infoHash>.torrent` y `dist/indexed-catalog.json`. Al repetirlo omite las entradas ya generadas; `--refresh` permite recalcular si el archivo remoto cambió.

Con el servidor abierto, agrega este repositorio en la configuración de extensiones de Hayase:

```text
http://127.0.0.1:8787/manifest.json
```

Busca **Sayonara Lara**, episodio **1**, resolución **720p**. El servidor es local y debe permanecer abierto. Si tu versión de Hayase rechaza repositorios HTTP locales, publica `dist` por HTTPS y vuelve a generar los enlaces como se explica abajo. Una búsqueda vacía también puede deberse a un título alternativo: se pueden agregar `aliases` o `anilistId` a la serie del catálogo. No se adivinan temporadas por coincidencias parciales.

## Actualizar series y ampliar el catálogo

```powershell
# Actualizar una serie, incluyendo capítulos nuevos
node scrape.mjs 7901 7901 --refresh

# Procesar un rango explícito, con pausa entre peticiones
$env:DELAY_MS = '1200'
node scrape.mjs 7902 8000

# Procesar hasta cinco archivos nuevos en 720p
node hash.mjs --resolution 720 --limit 5
```

Sin `--refresh`, el scraper omite las series guardadas. Con `--refresh`, reemplaza los episodios de las páginas recuperadas correctamente. Las páginas que fallen se conservan para reintentar; errores HTTP no se consideran contenido válido. El parser está adaptado al HTML adjunto y solo extrae la sección pública identificada por `Publicos-Paste.png`; cambios de estructura requieren ajustar el parser.

## Preparar para alojamiento

```powershell
npm run build -- https://tu-dominio.example/japanpaw/
```

Sube el contenido de `dist/` a esa ruta. Deben estar disponibles `manifest.json`, `index.js`, `icon.svg`, `indexed-catalog.json` y `torrents/`, con CORS habilitado. El build no borra los torrents ni el catálogo. No se ha publicado nada automáticamente. `npm run build` sin argumentos restaura la configuración local.

## Validación y límites

`npm test` verifica el HTML real, limpieza de enlaces, separación de temporadas, títulos Unicode, filtros de codecs, y generación de metadatos completos. La prueba de integración sirve bytes por HTTP y verifica cada pieza descargada contra su hash SHA-1 en el torrent, sin peers. Esto no sustituye una prueba del reproductor dentro de Hayase.

El servidor de video debe mantener los mismos bytes y permitir Range; una URL caducada o contenido modificado requiere actualizar la entrada. Los videos que necesitan cookies o cabeceras especiales no están cubiertos. No hay soporte de packs ni películas en esta versión. El hasher no añade trackers, pero la configuración del cliente Hayase determina el comportamiento P2P.

Los archivos `index.ts`, `index (1).ts`, `http.ts` y `hayase-*.ts` son referencias del código de Hayase, no forman parte del bundle. `test.mjs` y `test-stream.mjs` son experimentos anteriores; la validación vigente es `npm test`.

Referencias: [API de extensiones](https://wiki.hayase.watch/extensions/development/creating-extensions), [motor Hayase](https://github.com/hayase-app/torrent-client), [interfaz Hayase](https://github.com/hayase-app/interface), [BEP-19](https://www.bittorrent.org/beps/bep_0019.html).
