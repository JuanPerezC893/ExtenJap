# Corrección de preindexación 0.5.6

Parche local sobre `88d22f1`. Conserva WARP/Privoxy y el estado de Drive. No está publicado en Git: hacer `git pull` no instala este parche.

El registro analizado contiene 199 menciones de HTTP 404, 76 de HTTP 429 y una de HTTP 401. Son menciones, no necesariamente solicitudes distintas: algunas líneas describen pausas previamente registradas. No contiene HTTP 403. Los 429 mostrados corresponden a descargas de torrents de Nyaa.

Cambios:

- Un vídeo con 404/410 dispara una consulta a la página original (`sourceV`), compartida por serie durante la tanda. Solo se acepta un enlace publicado con igual nombre de archivo, episodio y resolución; se verifican tamaño y piezas SHA1 antes de guardarlo. Se conservan el enlace original y el actualizado. Si no hay sustituto inequívoco, queda `needs_review: SOURCE_NOT_FOUND`.
- Nyaa descarga con un trabajador y al menos 1500 ms entre solicitudes, aunque el intervalo general sea menor. Se respeta `Retry-After`; los candidatos de un host en pausa no agotan el presupuesto de candidatos. Un torrent con 401/404/410 se descarta sin interpretarlo como incompatibilidad de vídeo.
- El rescate usa consultas de episodios verificados, no repite primero el CRC. Reserva hasta el 10 % del límite (mínimo un intento si el límite es al menos tres) para rescatar fallos de esta tanda; tiene un máximo de 100 intentos y respeta el presupuesto total `attempted + rescueAttempted <= limit`. Guarda también los resultados fallidos y propaga errores de disco.
- Los diferidos cuyo plazo venció vuelven a intentarse. `--force-lock` conserva las pausas de proveedores. Los no encontrados, incompatibles y pendientes de revisión requieren `--retry-pending` o cambios en el catálogo.
- La reanudación comprueba que existan los torrents mediante una lectura del directorio, sin abrir miles de archivos en Drive. El registro muestra motivos de descarte.

## Aplicar en Colab

Detén la celda de indexación y espera a que guarde. Descarga `JapanPaw-parche-0.5.6.zip` desde la respuesta de Codex y ejecuta esta celda **después** de la celda que actualiza el repositorio:

```python
from google.colab import files
import io, zipfile
uploaded = files.upload()  # Seleccionar JapanPaw-parche-0.5.6.zip
with zipfile.ZipFile(io.BytesIO(uploaded['JapanPaw-parche-0.5.6.zip'])) as patch:
    patch.extractall('/content/ExtenJap')
```

El ZIP contiene código y esta guía; no contiene ni sobrescribe resultados de Drive. No vuelvas a ejecutar la actualización de Git después de aplicar el parche.

Ejecuta una tanda de comprobación antes de activar AUTO_LOOP, manteniendo WARP/Privoxy como en la ejecución anterior:

```bash
cd /content/ExtenJap
node indexer.mjs --catalog /content/ExtenJap/raw-catalog.json --state-dir /content/drive/MyDrive/JapanPaw-index --concurrency 4 --limit 100 --max-minutes 15 --interval-ms 300 --proxy --proxy-file /content/proxies.txt --retry-pending
```

El encabezado debe indicar `Indexer v0.5.6`. `--retry-pending` permite probar los fallos guardados por versiones anteriores; omítelo al continuar con archivos nuevos. Conserva `indexer-report.json` y `indexer-state.json` para distinguir recuperados, enlaces sin sustituto y proveedores en pausa.

## Límites de la validación

Las pruebas automatizadas usan servidores simulados para ejercitar recuperación, errores de acceso, reanudación y verificación de piezas. Una consulta real a `https://paste.japan-paw.net/?v=7400` devolvió HTTP 200 y diez enlaces, sin el episodio 1 presente en el catálogo local. Esto confirma un caso de desactualización; no demuestra que todos los 404 sean reparables. La ejecución completa con la red y el estado actual de Colab sigue pendiente. Muestrear piezas tampoco equivale a verificar cada byte del vídeo.
