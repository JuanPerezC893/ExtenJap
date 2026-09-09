# Indexación por tandas en Google Colab

El cuaderno recomendado es `Colab_Indexador_Reanudable.ipynb`. Los cuadernos anteriores se conservan como historial; algunos ejecutan una cola completa, no guardan el estado fuera de la sesión o exportan un ZIP incompleto para reanudar.

## Preparar el código y el almacenamiento

1. Usa el código que incluye estas correcciones. Un `git clone` descarga la versión publicada; no incluye cambios que solo estén en tu PC. El cuaderno permite subir un ZIP del proyecto corregido y extraerlo en una carpeta nueva, o clonar/actualizar el repositorio.
2. Instala las dependencias con `npm ci`. No hace falta un token de GitHub ni publicar resultados para ejecutar el indexador.
3. Monta Google Drive. El ejemplo guarda resultados en `/content/drive/MyDrive/JapanPaw-index`, separados del código en `/content/ExtenJap`.
4. Solo en la primera ejecución, copia el registro `verified-matches.json` y sus archivos `dist/torrents/` existentes a ese directorio. El cuaderno copia los torrents antes de instalar el registro y nunca reemplaza un registro de trabajo existente. Así conserva asociaciones ya obtenidas sin marcarlas como nuevas verificaciones.

Mantén **una sola sesión indexadora por directorio de estado**. Dos procesos con el mismo registro pueden sobrescribir avances. El guardado por archivo temporal y reemplazo ayuda frente a interrupciones normales; el montaje remoto de Drive no equivale a una transacción de base de datos ni garantiza persistencia inmediata si se pierde la sesión. Conserva también exportaciones periódicas.

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

## Interpretar el resultado

| Código de salida | Significado | Acción |
| --- | --- | --- |
| `0` | Terminó la tanda o alcanzó su presupuesto | Revisar el resumen; ejecutar otra tanda si corresponde |
| `2` | Hay trabajo diferido por disponibilidad o limitación de proveedores | Conservar el estado y esperar la pausa indicada |
| `130` | Interrupción solicitada | Conservar el punto de control y reanudar después |
| `1` | Error fatal | Leer el error antes de continuar o compilar |

El cuaderno envía `SIGINT` al proceso cuando interrumpes la celda y le da tiempo para cerrar. Evita detener forzosamente el entorno mientras está guardando. Si la sesión desaparece sin aviso, reanuda desde el último punto que llegó a Drive.

El registro de trabajo diferencia asociaciones preparadas, pendientes, problemas de red y entradas que requieren revisión. **Un error de red no demuestra que el torrent no exista.** Tampoco una serie sin AniList ID es necesariamente contenido occidental: puede ser anime que todavía no fue vinculado.

La validación compara metadatos y una muestra de piezas HTTP con sus hashes. Es evidencia de correspondencia de los bytes comprobados; no significa haber descargado y validado el archivo completo, ni garantiza disponibilidad o velocidad futura. El mapeo de anime y la numeración del episodio requieren controles separados. No renumeres masivamente a partir de nombres: algunos usan numeración absoluta, temporadas o episodios especiales.

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
