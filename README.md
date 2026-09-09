# Japan-Paw para Hayase

La extensión lee catálogos preparados por AniList ID. El indexador busca metadatos por separado, comprueba muestras del archivo HTTP y añade el webseed al `.torrent`. El catálogo completo de enlaces no equivale a contenido listo para reproducir.

## Indexador 0.5.5

- Antes de buscar, solicita un rango de un byte al video. Si el servidor rechaza la petición, el archivo queda diferido sin gastar consultas a los buscadores.
- Los diagnósticos distinguen `video_probe`, `search`, `torrent_download` y `video_pieces`, con host y código HTTP. Un error de acceso o HTML servido como torrent nunca se interpreta como hash incompatible.
- Todos los trabajadores comparten las pausas de los servidores. Se conservan al reiniciar, incluido el servidor del video. Los fallos repetidos suspenden la tanda; no se cambian proxies para ignorar `Retry-After`.
- Las búsquedas y candidatos tienen presupuestos explícitos. Los proveedores alternativos se consultan dentro de ese presupuesto; no se hacen búsquedas ocultas por ID ni se acepta arbitrariamente el primer torrent de un espejo.
- Solo las asociaciones que superan las comprobaciones de piezas se publican. El muestreo incluye primera, central y última pieza cuando son distintas; la evidencia queda guardada. No equivale a verificar el archivo completo.

## Ejecutar por tandas

Desde la carpeta del proyecto, con Node.js 20 o posterior:

```powershell
npm ci
npm test
node indexer.mjs --catalog raw-catalog.json --concurrency 2 --limit 100 --max-minutes 15
```

Sin `--state-dir`, usa las asociaciones y torrents existentes de esta carpeta. Para trabajar en otro directorio, añade `--state-dir RUTA`. El nuevo directorio empieza vacío: para conservar resultados anteriores usa su directorio de estado o copia el registro y sus torrents juntos antes de empezar. El cuaderno de Colab hace esta copia inicial sin sobrescribir un registro existente.

Para priorizar un anime añade `--series 207809`, o un nombre. `--limit` cuenta intentos nuevos, no asociaciones reutilizadas; ejecutar otra tanda puede avanzar. Los pendientes se revisitan cuando vence su fecha de reintento. `--retry-pending` los adelanta explícitamente, pero no elimina las pausas de los servidores.

```powershell
node build.mjs
# Si usaste otro estado:
node build.mjs --state-dir RUTA
```

Compilar prepara `dist`; no publica ni hace commit/push. Hayase usa una sola extensión de tipo torrent con webseed incorporado. La extensión HTTP antigua ya no forma parte del manifiesto.

## Google Colab

Abre `Colab_Indexador_Reanudable.ipynb` y sigue [la guía](docs/COLAB.md). El cuaderno permite cargar el ZIP corregido, monta Drive y conserva el estado entre sesiones. No elimina cambios locales de Git ni reinicia todos los pendientes automáticamente. Para probar las correcciones locales debes usar el ZIP actualizado; clonar Git descarga únicamente lo publicado.

La conexión directa es el valor predeterminado. Un proxy configurado se activa con `--proxy --proxy-file RUTA`; no se descargan listas públicas automáticamente. El proxy también se usa para el servidor del video. Las mismas pausas y verificaciones se aplican en ambos modos.

## Resultados y reanudación

- `verified-matches.json`: asociaciones y evidencia de las comprobaciones.
- `indexer-state.json`: estado por archivo, errores y pausas de servidores.
- `indexer-report.json`: resumen de la última tanda y solicitudes por host.
- `dist/torrents/`: archivos necesarios para compilar y reutilizar asociaciones.

Conserva estos archivos juntos. Un único proceso puede escribir en un directorio de estado. Ante una interrupción normal se cancelan peticiones, se guarda el avance y se libera `indexer.lock`. Si se pierde la sesión de golpe, confirma que el proceso anterior terminó antes de retirar un lock residual; nunca borres el registro para resolverlo.

Código de salida: `0` tanda terminada o límite alcanzado; `2` trabajo diferido por acceso; `130` interrupción; `1` error fatal. Un `0` no afirma que se preparó todo el catálogo.

Los conflictos detectados de episodio, tamaño o temporadas quedan en `needs_review`. No se corrigen automáticamente los IDs ni la numeración: nombres con offsets absolutos o temporadas pueden necesitar una asociación explícita.

## Validación

`npm test` usa fixtures y servidores HTTP locales; las pruebas no editan el catálogo ni el registro de trabajo. Se comprueban, entre otros casos, límites compartidos, respuestas de bloqueo, muestras SHA-1, concurrencia y reanudación.

Una prueba real desde este PC preparó Sora wa Akai Kawa no Hotori, episodio 1, 1080p, y compiló su catálogo. El diagnóstico queda en `artifacts/diagnostico-local/`. Este resultado no comprueba la conexión de Colab ni garantiza disponibilidad o velocidad futura.
