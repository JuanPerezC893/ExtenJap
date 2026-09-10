# Preindexación 0.5.7: comprobar la lectura y conservar los candidatos

## Qué revela la tanda de 5843940

La tanda preparó cero archivos, reutilizó 1597, clasificó 75 como `SOURCE_NOT_FOUND` y terminó después de nueve fallos de lectura de piezas. El cierre se produjo por `TIMEOUT` y `HOST_COOLDOWN` en `anime.craftervault.com`. El registro no permite atribuirlos únicamente a saturación, pero el código permitía doce verificaciones simultáneas y plazos de 20 segundos que también podían incluir espera en cola.

Una comprobación posterior desde este PC obtuvo HTTP 206 y tamaño 1398350956 para BAKI-DOU episodio 1, señalado con 404 en Colab. Iruma temporada 4 episodio 1 siguió devolviendo 404 desde este PC. No son pruebas simultáneas ni utilizan la misma ruta: demuestran que no corresponde tratar todos esos 404 como desapariciones definitivas.

## Cambios implementados

- La búsqueda y la lectura tienen límites independientes. `--concurrency` controla trabajadores; `--video-concurrency` limita verificaciones completas, por defecto dos. Esperar turno no consume el plazo de transferencia.
- Las piezas tienen un plazo de 60 segundos, configurable con `--piece-timeout-ms`; ese mismo plazo llega al transporte por proxy. El plazo total de la tanda sigue vigente.
- Después de validar metadatos y tamaño, el candidato se guarda en `STATE/pending/<clave>.torrent` antes de leer las piezas. Un error de vídeo conserva ese archivo y corta el intento; no prueba otros torrents contra el mismo fallo de lectura. La siguiente tanda prioriza esos candidatos y puede verificarlos aunque los buscadores estén en pausa. Al preparar o descartar el candidato se elimina el archivo pendiente. Se vuelven a comprobar las muestras; no se omite SHA1.
- Una pausa de un host de vídeo permite continuar con los demás. El informe incluye `pausedVideoHosts`.
- El tamaño del vídeo obtenido con la consulta de un byte se compara con el torrent antes de descargar piezas.
- Los 404 sin sustituto pasan a `deferred: SOURCE_UNAVAILABLE`, con nueva comprobación después de seis horas. Los antiguos `SOURCE_NOT_FOUND` se reconsideran automáticamente una vez al encontrar esas tareas; no se modifica todo el catálogo ni se declara que hayan desaparecido.
- `check-video-path.mjs` prueba pares ya verificados, sin consultar buscadores ni alterar el registro. Guarda etapas, errores, duración y muestras SHA1 en `video-path-report.json`.
- El notebook ejecuta ese control antes de la tanda y detiene AUTO_LOOP si no hubo nuevas preparaciones. Sus valores iniciales son cuatro buscadores, dos verificadores y cien intentos.

## Instalar en Colab

Este cambio está local, sobre `5843940`; todavía no se obtiene con `git pull`. Descarga `JapanPaw-parche-0.5.7.zip`, detén la indexación y aplica el ZIP después de actualizar el repositorio:

```python
from google.colab import files
import io, zipfile
uploaded = files.upload()
with zipfile.ZipFile(io.BytesIO(uploaded['JapanPaw-parche-0.5.7.zip'])) as patch:
    patch.extractall('/content/ExtenJap')
```

El ZIP contiene código, pruebas y el notebook actualizado; no contiene el catálogo ni el estado de Drive. Extraerlo no actualiza las celdas de un notebook ya abierto: abre el notebook nuevo o ejecuta los siguientes comandos directamente. No ejecutes nuevamente la actualización de Git después de aplicar el parche.

## Primero, una prueba que distinga la búsqueda de la lectura

Conserva la configuración WARP/Privoxy que estabas utilizando:

```bash
cd /content/ExtenJap
node check-video-path.mjs --state-dir /content/drive/MyDrive/JapanPaw-index --limit 3 --max-minutes 5 --proxy --proxy-file /content/proxies.txt
```

Lee `video-path-report.json`. El comando no busca torrents: usa los que ya habías verificado. Un fallo aquí debe investigarse en el archivo o la ruta de lectura, antes de ajustar la búsqueda. Si no hay torrents preparados disponibles, el control no puede dar un resultado; en una instalación nueva se puede desactivar `CHECK_VIDEO_FIRST` para preparar los primeros pares.

Si el control pasa, ejecuta:

```bash
node indexer.mjs --catalog /content/ExtenJap/raw-catalog.json --state-dir /content/drive/MyDrive/JapanPaw-index --concurrency 4 --video-concurrency 2 --piece-timeout-ms 60000 --limit 100 --max-minutes 15 --interval-ms 300 --proxy --proxy-file /content/proxies.txt
```

Conserva `pending/` junto con los JSON y `dist/torrents/` en Drive. Para evaluar esta tanda compara nuevas preparaciones, causas de fallo y cantidad de candidatos pendientes, no solo el número de archivos recorridos. No actives AUTO_LOOP para insistir en un control de vídeo fallido.

## Evidencia y límites

Además de las pruebas automatizadas, el control real local verificó correctamente dos pares: uno en `anime.craftervault.com` en 7761 ms y otro en `emision.craftervault.com` en 7328 ms. Eso comprueba lectura y muestras de piezas desde este PC, no desde la conexión de Colab. La prueba equivalente en Colab es el siguiente dato necesario; no se promete que el cambio repare enlaces ausentes, variantes incompatibles ni todos los fallos del proveedor.
