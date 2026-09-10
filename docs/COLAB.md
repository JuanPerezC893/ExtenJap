# Indexación por tandas en Google Colab

El cuaderno recomendado es `Colab_Indexador_Reanudable.ipynb`. Los cuadernos anteriores se conservan como historial; algunos ejecutan una cola completa, no guardan el estado fuera de la sesión o exportan un ZIP incompleto para reanudar.

## Preparar el código y el almacenamiento

1. Usa el código que incluye estas correcciones. El cuaderno empieza con `SOURCE_MODE = "upload"` para cargar el ZIP corregido que recibiste y extraerlo en una carpeta nueva. Un `git clone` descarga la versión publicada; no incluye cambios que solo estén en tu PC.
2. Instala las dependencias con `npm ci`. No hace falta un token de GitHub ni publicar resultados para ejecutar el indexador.
3. Monta Google Drive. El ejemplo guarda resultados en `/content/drive/MyDrive/JapanPaw-index`, separados del código en `/content/ExtenJap`.
4. Solo en la primera ejecución, copia el registro `verified-matches.json` y sus archivos `dist/torrents/` existentes a ese directorio. El cuaderno copia los torrents antes de instalar el registro y nunca reemplaza un registro de trabajo existente. Así conserva asociaciones ya obtenidas sin marcarlas como nuevas verificaciones.

Mantén **una sola sesión indexadora por directorio de estado**. Dos procesos con el mismo registro pueden sobrescribir avances. El guardado por archivo temporal y reemplazo ayuda frente a interrupciones normales; el montaje remoto de Drive no equivale a una transacción de base de datos ni garantiza persistencia inmediata si se pierde la sesión. Conserva también exportaciones periódicas.

Para usar la versión publicada, selecciona `SOURCE_MODE = "git"`. En una copia ya existente la actualización requiere además `UPDATE_FROM_GIT = True` en la celda de preparación. El cuaderno comprueba que no haya cambios locales y ejecuta `git pull --ff-only`; si encuentra modificaciones o una historia divergente, se detiene conservándolas. Las celdas de indexación no descargan código ni restablecen el repositorio. Para instalar otro ZIP usa una carpeta nueva y conserva el mismo directorio de estado en Drive.

## Ejecutar una tanda pequeña

Desde la carpeta del proyecto:

```bash
node indexer.mjs \
  --catalog /content/ExtenJap/raw-catalog.json \
  --state-dir /content/drive/MyDrive/JapanPaw-index \
  --concurrency 2 \
  --limit 100 \
  --max-minutes 15
```

Para priorizar una serie, agrega `--series 185874` o el nombre exacto que quieras filtrar. Los límites permiten inspeccionar resultados y tráfico antes de aumentar el trabajo. Llegar al límite de tiempo o archivos significa que terminó la tanda, no que se indexó el catálogo completo.

La conexión directa es el valor predeterminado. Más trabajadores no eliminan un bloqueo ni justifican ignorar `Retry-After`. Cuando un proveedor limita peticiones, el indexador conserva el estado y difiere trabajo. `--retry-pending` permite volver a intentar pendientes explícitamente, respetando la pausa vigente del proveedor; no es una opción para saltarse esa pausa.

`RETRY_PENDING = False` es el valor inicial del cuaderno. Activarlo en todas las tandas puede gastar el presupuesto repitiendo los mismos pendientes. Úsalo después de revisar la causa y cuando corresponda volver a probar. `USE_PROXIES = False` también es el valor inicial; si lo activas, debes proporcionar un archivo de proxies. Si el archivo falta, el cuaderno se detiene en lugar de cambiar silenciosamente a conexión directa.

## Interpretar el resultado

| Código de salida | Significado | Acción |
| --- | --- | --- |
| `0` | Terminó la tanda o alcanzó su presupuesto | Revisar el resumen; ejecutar otra tanda si corresponde |
| `2` | Hay trabajo diferido por disponibilidad o limitación de proveedores | Conservar el estado y esperar la pausa indicada |
| `130` | Interrupción solicitada | Conservar el punto de control y reanudar después |
| `1` | Error fatal | Leer el error antes de continuar o compilar |

El cuaderno envía `SIGINT` al proceso cuando interrumpes la celda y le da tiempo para cerrar. Evita detener forzosamente el entorno mientras está guardando. Si la sesión desaparece sin aviso, reanuda desde el último punto que llegó a Drive.

El registro de trabajo diferencia asociaciones preparadas, pendientes, problemas de red y entradas que requieren revisión. **Un error de red no demuestra que el torrent no exista.** Tampoco una serie sin AniList ID es necesariamente contenido occidental: puede ser anime que todavía no fue vinculado.

### Diagnosticar antes de cambiar la conexión

El total de archivos `deferred` o el texto `INVALID_RESPONSE` por sí solos no identifican el servidor que falló ni demuestran un bloqueo de IP por Cloudflare. Revisa en el diagnóstico **la etapa, el host y el código HTTP** de la respuesta:

- **Búsqueda:** el proveedor no entregó su formato de resultados. Una respuesta HTML puede ser un desafío, una página de error o un cambio del endpoint; hay que examinar la evidencia registrada.
- **Descarga del torrent:** encontrar un candidato no garantiza que su enlace entregue un archivo `.torrent` válido. HTTP 200 con HTML sigue siendo un fallo de acceso/formato, no una incompatibilidad del video.
- **Comprobación del video:** el servidor del webseed debe devolver el rango de bytes solicitado. HTTP 403, 429, un rango ausente o una conexión cortada no equivalen a piezas con hashes distintos.

HTTP 403 confirma que esa solicitud fue rechazada; no prueba por sí solo quién la rechazó ni que todas las IP de Colab estén bloqueadas. HTTP 429 requiere respetar la pausa indicada. Una prueba local exitosa demuestra acceso desde esa ejecución concreta, no disponibilidad permanente ni que Colab deba funcionar igual. Los proxies y los endpoints JSON también pueden fallar; no hay una garantía de cero bloqueos por usarlos.

Guarda un diagnóstico de una tanda pequeña junto con su hora y versión de código. Después compara la misma etapa y el mismo archivo en el entorno donde falla. Evita lanzar otra tanda completa o borrar las pausas guardadas solo porque el resumen indique cero archivos preparados.

### Túnel recomendado en Colab: Cloudflare WARP + Privoxy

Para evitar el bloqueo `HTTP 403` que los servidores webseed aplican a las IPs de datacenter de Google Cloud, el cuaderno incluye la celda **2b** que activa Cloudflare WARP en modo proxy (`socks5://127.0.0.1:40000`) y crea un puente HTTP local con Privoxy (`http://127.0.0.1:8118`).

Esto permite:
1. No alterar la tabla de enrutamiento principal de Colab, evitando que la sesión del navegador se desconecte.
2. Salir a internet a través de la red Anycast de Cloudflare con latencia mínima y gran ancho de banda.
3. Descargar fragmentos de video y verificar hashes SHA-1 en Craftervault con total compatibilidad.

### Sondeo y selección de proxies alternativos para video

Si las peticiones de fragmentos de video son rechazadas con HTTP 403 desde Colab, puedes sondear y seleccionar proxies que realmente permitan descargar piezas de video y pasen la comprobación SHA-1:

```bash
node probe-video-proxies.mjs --discover --limit 10 --proxy-out /content/proxies.txt --state-dir /content/drive/MyDrive/JapanPaw-index
```

El script comprueba primero la conexión directa. Luego sondea candidatos (FreeProxy HTTPS/elite y listas públicas) solicitando el rango `bytes=0-0` y la primera pieza completa con verificación de hash SHA-1 real contra el webseed. Solo los proxies que entregan los bytes exactos y cuyo SHA-1 coincide se consideran utilizables y se guardan en `/content/proxies.txt`. Si ningún proxy pasa la prueba, el informe en `artifacts/proxy-diagnostic/report.json` documenta el código HTTP, la latencia y la etapa exacta del rechazo.

La validación compara metadatos y una muestra de piezas HTTP con sus hashes. Es evidencia de correspondencia de los bytes comprobados; no significa haber descargado y validado el archivo completo, ni garantiza disponibilidad o velocidad futura. El mapeo de anime y la numeración del episodio requieren controles separados. No renumeres masivamente a partir de nombres: algunos usan numeración absoluta, temporadas o episodios especiales.

### Test de estrés y búsqueda del límite de velocidad (Benchmark)

Para determinar la concurrencia y el espaciado más rápidos sin arriesgar bloqueos o pausas de trackers, puedes ejecutar el script de benchmark:

```bash
node benchmark-limits.mjs \
  --catalog /content/ExtenJap/raw-catalog.json \
  --state-dir /content/drive/MyDrive/JapanPaw-index \
  --proxy --proxy-file /content/proxies.txt \
  --batch-size 25
```

El benchmark evalúa progresivamente 6 niveles:
1. **Conservador:** 2 workers, 400 ms de intervalo
2. **Moderado:** 4 workers, 250 ms de intervalo
3. **Rápido:** 6 workers, 150 ms de intervalo
4. **Muy Rápido:** 8 workers, 80 ms de intervalo
5. **Extremo:** 12 workers, 30 ms de intervalo
6. **Límite Máximo:** 16 workers, 0 ms de intervalo

- **Protección automática:** si cualquier proveedor devuelve `HTTP 429` (Rate Limited) o entra en enfriamiento, el test se detiene de inmediato.
- **Sin desperdicio de cuota:** los archivos preparados en cada nivel quedan guardados en Drive de forma acumulativa y permanente.
- **Recomendación automática:** genera una tabla comparativa y sugiere la concurrencia e intervalo óptimos (`optimalLevel`) para configurar en la celda 3 (`CONCURRENCY` e `INTERVAL_MS`).

## Compilar, exportar y reanudar

Después de una tanda con salida `0`, `2` o `130`, puedes compilar las asociaciones preparadas que quedaron guardadas:

```bash
node build.mjs --state-dir /content/drive/MyDrive/JapanPaw-index
```

Comprueba el resultado del comando: compilar los avances no convierte los pendientes en éxitos.

Para conservar la reanudación, exporta **el directorio de estado completo**, incluidos:

- `indexer-state.json`: resultados por archivo y pausas de proveedores.
- `verified-matches.json`: asociaciones y evidencia de verificación.
- `dist/torrents/`: torrents asociados.
- `dist/data/` y demás archivos de `dist/`: publicación preparada, si compilaste.

Conserva también la versión del código y el catálogo de entrada utilizado. El cuaderno guarda una copia inicial del catálogo y un archivo con la referencia del código en Drive. Al actualizar el catálogo, conserva una copia identificable del nuevo archivo antes de ejecutar.

En una nueva sesión monta Drive, recupera el código y vuelve a usar el mismo `--state-dir`. No sobrescribas su registro con el del repositorio. No necesitas subir los archivos generados al historial de Git para reanudar.

Si descargas el ZIP y lo restauras en otro dispositivo, extráelo en un directorio nuevo y úsalo como `--state-dir`. Conserva una copia del ZIP original. El cuaderno no publica nada ni solicita credenciales para hacerlo.
