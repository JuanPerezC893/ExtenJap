# Análisis de 028a0dd y cambio de búsqueda 0.5.10

La tanda fue interrumpida y cerró guardando: 9 preparados, 4313 reutilizados, 18 diferidos, 299 sin coincidencia, 35 incompatibles y 62 aplazados sin consulta por disponibilidad. Entre los diferidos aparecen seis cancelaciones de trabajadores; no representan fallos independientes del proveedor.

El fallo dominante cambió respecto a la tanda anterior: esta vez son las búsquedas sin coincidencia. No hay evidencia en este registro de un bloqueo general de Cloudflare. Tampoco puede compararse velocidad o cobertura global directamente con tandas que recorrieron otros archivos.

## Problema confirmado

Para Bakuman S2, las cuatro consultas anteriores eran dos variantes de `[SphinxAnime] Bakuman S2 01`, duplicadas entre proveedores. No alcanzaban las consultas derivadas de `Bakuman (2010) S02E01.mkv` ni una búsqueda general de la serie.

En la comprobación real local, AnimeTosho devolvió cero resultados para esa consulta específica, `Bakuman S02E01` y `Bakuman 2nd Season 01`. Buscar `Bakuman` devolvió 75 resultados en AnimeTosho y 20 en AniSearch. Buscar `Onipan` devolvió 75 y 50, respectivamente. Esos resultados incluyen lotes completos y variantes distintas: encontrarlos no demuestra compatibilidad con Japan-Paw, y las respuestas de los proveedores no garantizan cubrir todo su histórico.

## Cambios implementados

- Se deriva una consulta del nombre del archivo, conservando códigos de temporada y episodio cuando existen.
- Se incluye una búsqueda general de serie, compartida entre episodios mediante caché. Las consultas usadas frecuentemente conservan su lugar en la caché.
- Sin CRC, el presupuesto puede incluir nombre de archivo, búsqueda general en ambos proveedores y alias. Con CRC se conservan las consultas exactas y se usa el espacio restante para alternativas. El máximo predeterminado sigue siendo cuatro consultas por archivo; no todas las estrategias caben siempre.
- Se distribuye el presupuesto de descargas entre las consultas restantes para evitar que el primer conjunto de candidatos incompatibles lo consuma completo.
- El estado y el journal guardan `searchTrace`: consulta, proveedor, estrategia, cantidad devuelta, candidatos elegibles, lotes y descargas. `searchDiagnosis` distingue respuestas vacías, resultados filtrados, metadatos no descargables e incompatibilidad.
- Los antiguos `not_found` sin `searchPlanVersion: 2` se reconsideran una vez con el plan nuevo al recorrerlos. Si vuelven a fallar, no se repiten automáticamente en cada tanda. Los preparados se reutilizan y las pausas de disponibilidad permanecen. Los incompatibles anteriores requieren un reintento explícito si se quieren revisar.

Se siguen rechazando lotes que la extensión no puede usar, tamaños distintos y piezas SHA1 que no coinciden. No se relaja la verificación para aumentar artificialmente los preparados.

## Aplicar y comprobar en Colab

Parche local sobre `028a0dd`, todavía no publicado en Git. Descarga `JapanPaw-parche-0.5.10.zip`, detén el indexador y aplícalo después de la actualización del repositorio:

```python
from google.colab import files
import io, zipfile
uploaded = files.upload()
with zipfile.ZipFile(io.BytesIO(uploaded['JapanPaw-parche-0.5.10.zip'])) as patch:
    patch.extractall('/content/ExtenJap')
```

El ZIP no contiene ni sobrescribe el catálogo o los resultados de Drive. Ejecuta primero una prueba de las series mencionadas en el registro:

```bash
cd /content/ExtenJap
node indexer.mjs --catalog /content/ExtenJap/raw-catalog.json --state-dir /content/drive/MyDrive/JapanPaw-index --series "Bakuman S2" "Onipan!" --concurrency 6 --video-concurrency 2 --limit 20 --max-minutes 15 --interval-ms 250 --proxy --proxy-file /content/proxies.txt
```

El encabezado debe indicar `Indexer v0.5.10`. Revisa nuevas preparaciones y `searchTrace` en el estado/journal. Una búsqueda amplia puede mejorar la selección, pero si solo existen lotes, otros encodes o archivos diferentes no habrá un torrent utilizable. La prueba en Colab debe establecer cuántos candidatos llegan a pasar SHA1.

## Validación

111 pruebas automatizadas aprobadas. Incluyen una respuesta general compartida que prepara dos episodios cuando sus búsquedas específicas están vacías, reserva de descargas para otro proveedor y reintento único de resultados antiguos. Las comprobaciones reales descritas arriba consultaron metadatos de búsqueda; no verificaron nuevos pares vídeo/torrent de Bakuman u Onipan.
