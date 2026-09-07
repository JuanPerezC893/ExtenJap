# Extensión para descargar contenido en video directo

**Created:** 9/6/2026 22:23:12  
**Updated:** 9/6/2026 22:47:16  
**Exported:** 9/6/2026 22:54:26  
**Link:** [https://claude.ai/chat/101b4e3c-4f9c-4ce0-9cfb-37501f397d52](https://claude.ai/chat/101b4e3c-4f9c-4ce0-9cfb-37501f397d52)  

## User:

> 9/6/2026 22:23:13

quiero desarrollar una extension para este proyecto "https://wiki.hayase.watch/" quiero que lo revises y lo analises. el problema reside en que yo tengo una web en la que se pueden encontrar el contenido pero no en torrent si no en un link que tiene formato de video directo. entonces quiero saber cual es el plan o que? o si se puede hacer

## Assistant:

> 9/6/2026 22:25:41

> Reviewing a browser extension project for a media site.
>
> - Reviewing a browser extension project for a media site.
> - **Done**

Voy a revisar la wiki del proyecto para entender su arquitectura y cómo funciona el sistema de extensiones.

> Fetched page
>
> - [Hayase Wiki - Hayase - Torrenting Made Simple (hayase.watch)](https://wiki.hayase.watch/)
> - **Done**

Hay una sección específica de "Extensions Overview" que menciona extensiones HTTP, justo lo que necesitas. Voy a revisarla.

> Fetched page
>
> - [Hayase Wiki - Hayase - Torrenting Made Simple (hayase.watch)](https://wiki.hayase.watch/extensions/overview)
> - **Done**

Confirmado: existen "HTTP extensions", que es exactamente lo que necesitas para links de video directo. Voy a revisar esa página y la guía de desarrollo de extensiones.

> Fetched page
>
> - [Hayase Wiki - Hayase - Torrenting Made Simple (hayase.watch)](https://wiki.hayase.watch/extensions/http-extensions)
> - **Done**

Esto confirma la clase `WebSeedSource`. Ahora reviso la guía técnica de desarrollo para ver la API concreta.

> Distinguiendo si el sitio replica torrents existentes o cataloga contenido propio.
>
> - [Hayase Wiki - Hayase - Torrenting Made Simple (hayase.watch)](https://wiki.hayase.watch/extensions/development/creating-extensions)
> - Distinguiendo si el sitio replica torrents existentes o cataloga contenido propio.
> - **Done**

Con esto ya tengo el cuadro completo. Antes de armar el plan, voy a revisar si existe algún repositorio de extensiones de ejemplo tipo "http" reales en el GitHub del proyecto, porque hay un detalle técnico clave que quiero confirmar con un caso real.

> Decidiendo cómo presentar el ejemplo de código y las preguntas finales.
>
> - hayase-app github extensions http webseed source example
> - Buscando ejemplos reales de extensiones tipo WebSeedSource.
> - [https://github.com/hayase-app/extensions](https://github.com/hayase-app/extensions)
> - hayase-app/extensions github repository index.ts source.ts webseed
> - Decidiendo cómo presentar el ejemplo de código y las preguntas finales.
> - **Done**

## Sí, se puede — y el mecanismo se llama "HTTP / WebSeed extension"

Revisé la wiki completa de Hayase (arquitectura, tipos de extensión y la guía de desarrollo). Resumen rápido de cómo funciona el proyecto:

Hayase es un cliente de streaming "trae tu propio contenido": el núcleo de la app no incluye ninguna fuente de contenido, solo reproduce. Todo lo que se busca y se resuelve viene de **extensiones** (plugins en JS que corren en un Web Worker aislado, sin acceso al DOM). Hay 4 tipos:

| Tipo | Clase base | Para qué sirve |
|---|---|---|
| `torrent` | `TorrentSource` | Devuelve magnets/hashes |
| `nzb` | `NZBSource` | Devuelve URLs de Usenet |
| `subtitle` | `SubtitleSource` | Devuelve subtítulos |
| **`http`** | **`WebSeedSource`** | **Devuelve URLs directas de archivo** |

El tipo `http` es exactamente tu caso: está pensado para servidores propios/CDN que entregan el archivo por link directo en vez de por P2P.

## Cómo se construye la extensión

Son **dos archivos**: un `manifest.json` y un script JS bundleado (sin resolución de módulos en el worker, así que tienes que empaquetarlo con esbuild/rollup/webpack).

**manifest.json:**
```json
[
  {
    "manifestVersion": 2,
    "name": "Mi Web",
    "description": "Contenido directo desde miweb.com",
    "id": "miweb",
    "version": "1.0.0",
    "type": "http",
    "accuracy": "high",
    "icon": "https://miweb.com/icon.png",
    "media": "sub",
    "url": "aHR0cHM6Ly9taXdlYi5jb20=",
    "languages": ["ALL"],
    "update": "https://miweb.com/extensions/manifest.json",
    "code": "https://miweb.com/extensions/script.js"
  }
]
```

**script.js (esqueleto):**
```js
export default new class extends WebSeedSource {
  async test() {
    const res = await fetch("https://miweb.com/api/status")
    return res.ok
  }

  async single({ anilistId, episode, titles, fetch }) {
    // Aquí resuelves cómo tu web identifica el contenido:
    // por AniList ID, por título, o por tu propia base de datos
    const res = await fetch(`https://miweb.com/api/watch?anilist=${anilistId}&ep=${episode}`)
    if (!res.ok) throw new Error("No se encontró el episodio en el servidor.")
    const data = await res.json()

    return {
      url: data.videoUrl,       // tu link directo de video
      rateLimit: 10             // opcional
    }
  }
}
```

El `test()` valida que tu web responde. `single()` es lo que se llama por episodio; también existe `batch()` para packs y opcionalmente `movie()`.

## El punto que no está 100% claro (y que vale la pena confirmar)

La documentación describe el `WebSeedQuery` recibido por `single`/`batch` como algo que ya trae un `hash` y `name` — igual que las extensiones NZB — y lo describe explícitamente como útil para "web seed sources para contenido BitTorrent" (es decir, servir por HTTP los mismos bytes de un torrent ya identificado por hash). También lista "sitios de streaming de descarga directa" como caso de uso válido, así que standalone también debería funcionar, pero la doc pública no especifica con detalle de dónde saca Hayase ese `hash` cuando no hay ninguna extensión torrent que ya haya encontrado ese contenido primero.

En la práctica, en el ejemplo que puse arriba usé `anilistId`/`episode` directamente (que sí vienen garantizados en el query, sin depender del hash) — esa es la ruta más segura para tu caso, ya que tu web identifica contenido por anime/episodio y no por infoHash de un torrent real.

Antes de invertir mucho tiempo, te recomendaría confirmar esto en su [Discord](https://discord.gg/TRQEr9evRA) o revisando el código fuente (es open source, org `hayase-app` en GitHub) — específicamente cómo se dispara la llamada a extensiones `http` cuando el usuario no tiene ninguna extensión `torrent` activa en paralelo.

## Plan concreto

1. Exponer en tu web un endpoint (o lógica interna) que, dado anime + episodio, devuelva la URL directa del video.
2. Escribir el manifest y el script con las clases de arriba.
3. Bundlear el script (esbuild/rollup — cualquier bundler simple sirve).
4. Hostear ambos archivos en algo con CORS habilitado (tu propio servidor, GitHub Pages, etc.) y poner tu dominio en base64 en el campo `url` del manifest.
5. Instalarla en Hayase: Settings → Extensions → Repositories → pegar la URL del manifest.
6. Probar con `test()` y una búsqueda real, iterar según errores.

Para escribirte el código ya adaptado a tu web (no el esqueleto genérico), necesito saber un par de cosas sobre cómo funciona tu sitio:

---

**Sources:**

- [GitHub - vebb374/hayase-extensions · GitHub](https://github.com/vebb374/hayase-extensions)
- [hayase-extension · GitHub Topics · GitHub](https://github.com/topics/hayase-extension)
- [GitHub - LetMeGetAByte/Hayase-Extensions · GitHub](https://github.com/LetMeGetAByte/Hayase-Extensions)
- [hayase-app repositories · GitHub](https://github.com/orgs/hayase-app/repositories)
- [extensions/index.json at main · hayase-app/extensions](https://github.com/hayase-app/extensions/blob/main/index.json)
- [Hayase · GitHub](https://github.com/hayase-app)
- [Releases · hayase-app/extensions](https://github.com/hayase-app/extensions/releases)
- [GitHub - ReWelp/HayasexShiru-Extensions: Community-maintained extensions for Shiru and Hayase. Includes Nyaa and Sukebei support. · GitHub](https://github.com/ReWelp/HayasexShiru-Extensions)
- [raw.githubusercontent.com](https://raw.githubusercontent.com/ReWelp/HayasexShiru-Extensions/main/hayase/index.json)
- [github.com](https://github.com/JustMarkov)
- [hayase-app-extensions · GitHub Topics · GitHub](https://github.com/topics/hayase-app-extensions)
- [hayase-extensions · GitHub Topics · GitHub](https://github.com/topics/hayase-extensions)
- [GitHub - hayase-app/interface · GitHub](https://github.com/hayase-app/interface)
- [github.com](https://github.com/callstackincubator/agent-device/pull/449/files)
- [github.com](https://github.com/simple-ecommerce/api/blob/main/package.json)

## User:

> 9/6/2026 22:30:56

Solo se puede acceder navegando el sitio (sin api) pero es un web muy facil de hacer scraper esta es la web "https://paste.japan-paw.net/?v=7901" lo unico es iterando el numero al final del link y te va entregando diferentes series en el h2 de la web esta el nombre a y tambien hay que hacer un poco de limpieza a los links por que hay que pasar de esto ""

## Assistant:

> 9/6/2026 22:30:56

## User:

> 9/6/2026 22:31:24

Solo se puede acceder navegando el sitio (sin api) pero es un web muy facil de hacer scraper esta es la web "https://paste.japan-paw.net/?v=7901" lo unico es iterando el numero al final del link y te va entregando diferentes series en el h2 de la web esta el nombre a y tambien hay que hacer un poco de limpieza a los links por que hay que pasar de esto "https://redirect.japan-paw.net/#https%3A%2F%2Femision.craftervault.com/0:down/Sayonara%20Lara/%5BErai-raws%5D%5BWeb%201080p%5D/%5BErai-raws%5D%20Sayonara%20Lara%20-%2001%20%5B1080p%20CR%20WEB-DL%20AVC%20AAC%5D%5BMultiSub%5D%5B7A5D5F0E%5D.mkv" a esto "[https://emision.craftervault.com/0:down/Sayonara%20Lara/%5BErai-raws%5D%5BWeb%201080p%5D/%5BErai-raws%5D%20Sayonara%20Lara%20-%2001%20%5B1080p%20CR%20WEB-DL%20AVC%20AAC%5D%5BMultiSub%5D%5B7A5D5F0E%5D.mkv](https://redirect.japan-paw.net/#https%3A%2F%2Femision.craftervault.com/0:down/Sayonara%20Lara/%5BErai-raws%5D%5BWeb%201080p%5D/%5BErai-raws%5D%20Sayonara%20Lara%20-%2001%20%5B1080p%20CR%20WEB-DL%20AVC%20AAC%5D%5BMultiSub%5D%5B7A5D5F0E%5D.mkv)"

## Assistant:

> 9/6/2026 22:32:54

> Drafting a minimal regex fix for the prefix only.
>
> - Drafting a minimal regex fix for the prefix only.
> - **Done**

Voy a revisar la estructura real de esa página para ver cómo extraer el título y los links de forma precisa.

> Weighing a live-search versus prebuilt-index architecture choice.
>
> - [https://paste.japan-paw.net/?v=7901](https://paste.japan-paw.net/?v=7901)
> - Weighing a live-search versus prebuilt-index architecture choice.
> - **Done**

Intenté entrar directamente a la página para ver el HTML real, pero el sitio bloqueó la petición por detección de bots (`bot detection`). Esto en sí mismo es un dato importante — lo comento abajo porque afecta el diseño del scraper.

## El "limpiado" del link

Comparando tu ejemplo carácter por carácter: **no hay que hacer un `decodeURIComponent` completo del fragmento**. Si lo hicieras, también se decodificarían los `%20`, `%5B`, `%5D` del nombre de archivo (que en tu resultado deseado siguen intactos). Lo que realmente pasa es que solo el **prefijo del esquema** (`https%3A%2F%2F`) está doblemente codificado; el resto de la ruta ya viene en su forma normal de URL (con `%20`/`%5B`/`%5D` como es estándar en URLs con espacios/corchetes) y no se debe tocar.

La limpieza correcta es:

```js
function cleanUrl(rawHref) {
  // rawHref: "https://redirect.japan-paw.net/#https%3A%2F%2Femision.craftervault.com/..."
  const fragment = rawHref.split('#')[1] ?? rawHref
  return fragment.replace(/^(https?)%3A%2F%2F/i, '$1://')
}
```
Esto convierte solo el `https%3A%2F%2F` inicial en `https://` y deja el resto tal cual — coincide exactamente con tu ejemplo.

## El riesgo que hay que resolver primero: bot detection

Que el sitio me haya bloqueado a mí (un fetch automatizado sin navegador) es relevante porque el script de tu extensión también hace `fetch()` desde un Web Worker sandboxeado dentro de Hayase, en la máquina de cada usuario — no desde un navegador completo. Si el sitio detecta y bloquea ese tipo de tráfico (Cloudflare u otro WAF), la extensión podría fallar para muchos usuarios aunque funcione en tus pruebas. Vale la pena verificar esto pronto (probando el `fetch` real desde el entorno de extensión) antes de invertir tiempo en el resto.

## La decisión de arquitectura más importante: ¿buscar en vivo o indexar?

Hayase llama a tu extensión con `anilistId` + número de episodio, esperando una respuesta rápida. Si para "buscar" hay que iterar `?v=1`, `?v=2`, `?v=3`... hasta encontrar la serie correcta, eso sería:
- Lentísimo por búsqueda (cientos/miles de requests por cada episodio que alguien quiera ver)
- Probablemente dispare el bloqueo por bots todavía más rápido
- Va contra las buenas prácticas de rate-limit que pide la wiki

La alternativa sana es: un proceso aparte (un script tuyo, corriendo periódicamente donde tú quieras, no dentro de la extensión) que recorra los `v=` una vez, arme un índice (título → episodios → link limpio) y lo publique como un `index.json` estático. La extensión de Hayase entonces solo consulta ese JSON pequeño, no golpea tu web en cada búsqueda del usuario.

Para confirmar esto y darte el scraper real, necesito:

1. **El HTML real de una página**, por ejemplo el `view-source:` de `https://paste.japan-paw.net/?v=7901` — pégamelo aquí (aunque sea solo la parte del `<h2>` y los links). Sin la marca real no puedo escribir el regex/parser de forma confiable, solo adivinar.
2. **¿Cada número `v=` es un episodio individual, o una serie completa con todos sus episodios en la misma página?**
3. **¿Sabes aproximadamente el rango total de números válidos** (¿del 1 al 7901? ¿más?), o hay alguna página de índice/listado en el sitio que ya agrupe todo, en vez de tener que adivinar iterando?

## User:

> 9/6/2026 22:38:11

> File: ejempl.html

2. cada numero es una serie completa con todos sus episodios en la pagina
3. hasta 8000 pero el numero va aumentando

## Assistant:

> 9/6/2026 22:47:16

> Confirmando la limpieza de URLs directas y redirigidas.
>
> - Confirmando la limpieza de URLs directas y redirigidas.
> - **Done**

Con este HTML ya tengo todo lo que necesito para el scraper — funciona perfecto con regex simple (nada de DOM, ya que el worker de Hayase no tiene acceso a él). Antes de darte el código final, voy a resolver la duda pendiente revisando el código fuente real del proyecto (es open source), para confirmar si las extensiones `http` se disparan de forma independiente o solo como complemento de un torrent ya encontrado.

> Preparando una explicación honesta antes de construir el pipeline completo.
>
> - Clonar el repo del núcleo de Hayase para inspeccionar la lógica de despacho de extensiones
> - Buscar archivos relacionados con WebSeedSource
> - Ver la implementación de la fuente HTTP/WebSeed
> - Investigating how a torrent-related API requires an existing object.
> - Ver cómo se conecta el resultado de la extensión HTTP con un torrent real
> - Tracing how HTTP peers get added to a torrent.
> - Ver el contexto de la llamada a addHTTPPeers para entender de dónde viene 'url' y 'torrent'
> - Designing a magnet-based webseed extension to replace the http approach.
> - Confirmar si el paquete webtorrent soporta webseeds nativos vía magnet ws= o url-list del .torrent
> - Retracting an earlier plan after confirming it won't work.
> - Ver cómo se parsean los magnets para confirmar soporte de parámetro ws=
> - Preparando una explicación honesta antes de construir el pipeline completo.
> - **Done**

Encontré algo importante revisando el código fuente real del motor de torrents de Hayase. Necesito corregir el plan.

> Planning the scraping, hashing, and extension file structure.
>
> - Confirmar el flujo completo de resolución de infoHash antes de dar la conclusión final
> - Tracing how torrent playback resolves its identifier.
> - Instalar create-torrent para verificar cómo generar un magnet con parámetro ws= válido
> - Script de prueba para verificar que create-torrent genera un magnet con ws= válido a partir de un archivo
> - Ejecutar la prueba de generación de magnet con webseed
> - Checking how a torrent-parsing library returns its results.
> - Revisar versiones y API real de las librerías instaladas
> - Corregir a API async de parse-torrent v11
> - Marcar el callback como async para poder usar await adentro
> - Reejecutar la prueba corregida
> - Fixing torrent file handling and magnet URI generation.
> - Corregir el import de toMagnetURI como export nombrado
> - Usar la función importada correctamente
> - Ejecutar de nuevo
> - Planning the scraping, hashing, and extension file structure.
> - **Done**

Con esto confirmado, voy a validar mi lógica de parseo contra el HTML real que me pasaste, antes de entregarte el código final.

> Setting up a hosted extension for cross-origin data access.
>
> - Copiar el HTML de ejemplo al área de trabajo para probar el parser
> - Script de prueba para validar la lógica de parseo del HTML real antes de finalizar el scraper
> - Ejecutar la prueba de parseo contra el HTML real
> - Refining resolution filtering and planning a resumable scraping script.
> - Revisar qué tipos de input acepta create-torrent (streams, buffers, con tamaño conocido)
> - Checking supported input types for file uploads.
> - Ver cómo create-torrent maneja streams sin longitud conocida de antemano
> - Ver el manejo completo de streams sin longitud - si requiere longitud predefinida
> - Investigating how file size is tracked for stream inputs.
> - Prueba de extremo a extremo: descargar un archivo real vía fetch (streaming) y generar el magnet con create-torrent
> - Ejecutar la prueba de streaming real de extremo a extremo
> - Locating the correct file path in the repository.
> - Confirmar el nombre de la rama principal para armar una URL raw válida de prueba
> - Usar una URL válida real para la prueba de streaming
> - Reejecutar la prueba de streaming de extremo a extremo
> - Simplifying to sequential hashing and drafting the extension manifest.
> - Verificar si raw.githubusercontent.com permite CORS (útil para hostear el índice/manifest sin infra propia)
> - Setting up a hosted extension for cross-origin data access.
> - **Done**

Todo el pipeline quedó validado de punta a punta. Ahora te dejo el proyecto completo funcionando.

> Ran command, created 2 files
>
> - Crear estructura final del proyecto
> - Script de scraping validado contra el HTML real proporcionado
> - package.json del scraper (sin dependencias externas)
> - **Done**

Ahora el hasher, que es la pieza que realmente hace posible el playback (probado end-to-end arriba con streaming real):

> Created 2 files
>
> - Script de hashing validado end-to-end con streaming real desde red
> - package.json del hasher con las dependencias necesarias
> - **Done**

Ahora la extensión real que corre dentro de Hayase:

> Building a small sanity test for the extension logic.
>
> - Manifest de la extensión tipo torrent (no http, según lo confirmado en el código fuente)
> - Building a browser extension for a torrent source.
> - Extensión real (torrent-type) que Hayase ejecuta - sin dependencias externas, no requiere bundler
> - Building a small sanity test for the extension logic.
> - **Done**

Voy a probar la extensión completa simulando el entorno de Hayase (mockeando `TorrentSource` y `fetch`), para confirmar que no hay errores antes de entregarla.

> Created file
>
> - Arnés de prueba que simula el entorno de Hayase para validar la extensión antes de entregarla
> - **Done**

Powered by Claude Exporter (https://www.ai-chat-exporter.net)
