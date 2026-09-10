# Análisis de 49e8689 y revisión 0.5.9

La tanda terminó con 56 nuevos preparados, 4242 reutilizados, 1619 diferidos, 123 sin coincidencia y 102 incompatibles. Los mensajes de trabajadores contienen 1567 `SOURCE_UNAVAILABLE`; el rescate modifica algunos contadores finales. Las menciones HTTP no equivalen a solicitudes únicas: incluyen errores guardados en caché y errores originales junto a los del refresco.

El problema dominante fue la disponibilidad aparente del origen, sobre todo `emision.craftervault.com`. Hubo también 403 de lectura en `anime.craftervault.com`. No se debe interpretar toda esta tanda como un bloqueo de Cloudflare ni esperar que cambiar las consultas de torrents resuelva los 404.

## Fallo confirmado en el parser

El refresco usaba un parser que quitaba solamente la envoltura `redirect`, dejando destinos OUO en vez del vídeo. El filtro de extensiones descartaba esos enlaces. Con el mismo HTML real de Gachiakuta, la versión anterior extraía 44 enlaces y la corregida extrae 48, incluidos los episodios 1 y 2 de ambas resoluciones.

Esto corrige una conclusión anterior: que el parser no mostrara los primeros episodios no demostraba que faltaran en la página. Ahora scraper y refresco usan el mismo desenrollado local de destinos explícitos, conservando los escapes del path. No se visitan acortadores ni se inventan enlaces. Encontrar el enlace tampoco garantiza que el servidor entregue su vídeo; las verificaciones de tamaño y SHA1 siguen vigentes.

## Evitar gastar toda la tanda en una serie inaccesible

Las comprobaciones de disponibilidad se serializan por serie y host. Tras tres resultados `SOURCE_UNAVAILABLE`, se aplazan los restantes durante seis horas y se continúa con otras series. No se serializa la descarga de piezas: conserva su límite independiente de dos verificadores.

Los archivos aplazados sin consulta aparecen en `availabilitySkipped`; no cuentan como preparados ni consumen el presupuesto de intentos de red. Su estado se conserva en los JSON y en el journal. Cuando vence la pausa, se rota el orden para comprobar episodios posteriores al último examinado, evitando insistir siempre en los mismos tres.

Es una decisión de planificación, no una declaración de que todos los episodios estén caídos. Puede aplazar episodios accesibles dentro de una serie parcialmente disponible; la rotación permite volver a muestrearla después. No borres esas tareas ni compares solo el número de archivos recorridos: mide nuevas preparaciones por tiempo transcurrido.

## Aplicar en Colab

El parche se aplica sobre `49e8689`. Los cambios están locales, no publicados en Git. Detén la tanda, descarga `JapanPaw-parche-0.5.9.zip` y aplícalo después de actualizar el repositorio:

```python
from google.colab import files
import io, zipfile
uploaded = files.upload()
with zipfile.ZipFile(io.BytesIO(uploaded['JapanPaw-parche-0.5.9.zip'])) as patch:
    patch.extractall('/content/ExtenJap')
```

Conserva el estado de Drive y la configuración de WARP. El encabezado debe mostrar `Indexer v0.5.9`. No uses `--retry-pending` en cada vuelta para forzar enlaces diferidos. El refresco corregido se utilizará cuando corresponda volver a comprobarlos; no hace falta reconstruir el catálogo completo.

El mensaje de tu notebook abierto que afirma que basta esperar un minuto es antiguo. Los fallos de origen tienen plazos de seis horas; los límites del proveedor pueden tener otros. El CLI ahora lo aclara al terminar. Si usas el notebook incluido en el ZIP, debes abrirlo de nuevo: extraer un archivo no sustituye las celdas que ya tienes abiertas en Colab.

## Validación

Pruebas de regresión con enlaces reales envueltos, escapes de URL, doce trabajadores contra una serie inaccesible, continuidad de otra serie y rotación al expirar la pausa. En la prueba de planificación, seis enlaces inaccesibles producen tres consultas y tres aplazamientos, mientras otro archivo sí se prepara. El rendimiento efectivo y la recuperación de enlaces desde WARP siguen requiriendo una tanda en Colab.
