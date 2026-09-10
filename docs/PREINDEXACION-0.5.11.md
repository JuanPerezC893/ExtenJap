# Regresión de metadatos en a18c3b0

La tanda terminó interrumpida con 9 preparados, 1388 reutilizados, 330 diferidos, 90 sin coincidencia y 33 incompatibles. Los mensajes contienen 315 `HOST_COOLDOWN`, cinco `RATE_LIMITED` y rechazos reiterados de torrents con varios archivos. Las menciones repetidas de HTTP 429 incluyen pausas guardadas; no equivalen a otras tantas solicitudes a Nyaa.

La búsqueda amplia encontró candidatos, pero el indexador seguía admitiendo archivos cuando la descarga de metadatos estaba limitada. Además, distintos episodios podían descargar y rechazar el mismo lote varias veces. La mejora de búsqueda anterior necesitaba controlar también ese trabajo compartido.

## Correcciones 0.5.11

- Caché compartida de metadatos originales, limitada a 32 MiB y 128 entradas retenidas. Las solicitudes simultáneas de la misma URL comparten una descarga; se mantiene la comprobación de infohash para cada resultado. No se comparten torrents modificados con la URL de otro vídeo.
- Se recuerdan hasta 2048 URLs de torrents que no contienen un único archivo de vídeo. Los siguientes episodios las descartan antes de consumir su presupuesto de descargas. Esto dura la tanda; no se declara que el vídeo sea incompatible por pertenecer a un lote.
- Si tres archivos quedan diferidos por descargas de metadatos en pausa y esa pausa sigue vigente, se detiene la admisión de archivos nuevos con `metadata_unavailable`. Los trabajadores en curso terminan o guardan sus resultados. Los candidatos locales pendientes pueden avanzar sin buscar metadatos nuevos. Una preparación exitosa reinicia el contador de presión.
- El informe incluye `metadataCache.downloads`, `hits` y `unsupported`. Los errores de transporte no se conservan en la caché como fallos definitivos y se respetan las pausas del proveedor.

Esto evita desperdicio; no elimina los 429 ni añade soporte para reproducir un archivo dentro de un torrent de varios vídeos. No se relajan las verificaciones de tamaño y SHA1.

## Aplicar en Colab

Cambios locales sobre `a18c3b0`, aún no publicados en Git. Detén la tanda, descarga `JapanPaw-parche-0.5.11.zip` y aplícalo después de actualizar el repositorio:

```python
from google.colab import files
import io, zipfile
uploaded = files.upload()
with zipfile.ZipFile(io.BytesIO(uploaded['JapanPaw-parche-0.5.11.zip'])) as patch:
    patch.extractall('/content/ExtenJap')
```

Conserva los resultados de Drive. El ZIP contiene código, pruebas y esta guía; el encabezado debe mostrar `Indexer v0.5.11`. Mantén AUTO_LOOP desactivado durante la comprobación. Si termina con `metadata_unavailable`, conserva el estado y revisa el `retryAt` del host en `indexer-report.json`/`indexer-state.json`; no borres la pausa ni encadenes tandas para forzar descargas.

114 pruebas aprobadas. En la prueba con ocho archivos y un 429 persistente, hubo una solicitud a Nyaa, tres diferidos y cinco archivos sin intentar. También se comprobó la descarga compartida, el límite de memoria y el recuerdo de lotes no admitidos. La eficacia con los proveedores reales sigue pendiente de comprobar en Colab.
