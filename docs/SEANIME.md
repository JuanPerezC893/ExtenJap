# Seanime: Extensión Japan-Paw Directo

Esta extensión permite reproducir anime directamente desde Japan-Paw en [Seanime](https://seanime.app/) mediante streaming HTTP por el servicio local, sin descargas previas de torrents ni esperas de peers.

---

## Requisitos

1. Tener el servicio local encendido (el mismo que usa Stremio):
   ```powershell
   npm run stremio
   # o bien:
   .\iniciar-stremio.ps1
   ```
   El servicio escucha en `http://127.0.0.1:8790` y enruta los videos a través de Cloudflare WARP.

---

## Cómo Instalar en Seanime

Tienes tres formas según la pantalla de Seanime en la que te encuentres:

### Opción 1: Si usas «Change repository» (Pestaña Marketplace)
En Seanime, la pestaña **Marketplace** espera un archivo de catálogo (repositorio con una lista de extensiones). Usa esta URL:
```
https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/seanime-extension/marketplace.json
```
*(O la URL local si el servicio está iniciado: `http://127.0.0.1:8790/seanime/marketplace.json`)*
Aparecerá **Japan-Paw Directo** en el Marketplace con un botón **Install**.

### Opción 2: Si usas «Add extension» -> «Manifest URL» (Pestaña Extensions)
1. Ve a la pestaña **Extensions** (icono de puzzle 🧩) en Seanime.
2. Pulsa el botón **Add extension** (arriba a la derecha).
3. En el campo **Manifest URL**, pega:
```
https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/seanime-extension/manifest.json
```
*(O la URL local: `http://127.0.0.1:8790/seanime/manifest.json`)*
4. Pulsa **Fetch** y luego **Install**.

### Opción 3: Instalación Manual Directa (Sin dependencias de red)
1. Abre el cuadro Ejecutar en Windows (`Win + R`), escribe:
   ```
   %appdata%\Seanime\extensions
   ```
   y presiona Enter (si la carpeta `extensions` no existe dentro de `Seanime`, créala).
2. Copia la carpeta `seanime-extension` de este proyecto dentro de esa ruta y renómbrala como `japanpaw-direct`:
   ```
   %appdata%\Seanime\extensions\japanpaw-direct\
       ├── manifest.json
       ├── marketplace.json
       └── provider.js
   ```
3. Reinicia Seanime. Ya aparecerá instalada automáticamente.

---

## Cómo Reproducir en Seanime

1. Abre cualquier serie en tu biblioteca de Seanime o búscala en la pestaña de AniList.
2. Haz clic en el botón de **Online Streaming** / **Fuentes de reproducción** (icono de nube o play).
3. En la lista de proveedores, selecciona **Japan-Paw Directo**.
4. Elige el servidor/calidad deseada (**Japan-Paw 1080p** o **Japan-Paw 720p**).
5. Pulsa en el episodio para reproducir. El video se transmitirá inmediatamente en tu reproductor preferido de Seanime (MPV o el reproductor web integrado) con sincronización automática de AniSkip y AniList.
