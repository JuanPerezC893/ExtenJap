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

Tienes dos formas muy sencillas de instalar la extensión:

### Método 1: Desde Seanime (Recomendado)
1. Abre **Seanime**.
2. En el menú lateral izquierdo, haz clic en el icono de **Extensions** (icono de pieza de rompecabezas 🧩).
3. Haz clic en **Add extension** o **Install extension**.
4. Pega la URL del manifiesto local:
   ```
   http://127.0.0.1:8790/seanime/manifest.json
   ```
   *(O la URL de GitHub si prefieres: `https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/seanime-extension/manifest.json`)*
5. Pulsa **Install** y activa la extensión.

### Método 2: Instalación Manual por Carpeta
1. Abre el cuadro Ejecutar en Windows (`Win + R`), escribe:
   ```
   %appdata%\Seanime\extensions
   ```
   y presiona Enter (si la carpeta `extensions` no existe, créala).
2. Copia la carpeta `seanime-extension` de este proyecto dentro de esa ruta y renómbrala como `japanpaw-direct`:
   ```
   %appdata%\Seanime\extensions\japanpaw-direct\
       ├── manifest.json
       └── provider.js
   ```
3. Reinicia Seanime.

---

## Cómo Reproducir en Seanime

1. Abre cualquier serie en tu biblioteca de Seanime o búscala en la pestaña de AniList.
2. Haz clic en el botón de **Online Streaming** / **Fuentes de reproducción** (icono de nube o play).
3. En la lista de proveedores, selecciona **Japan-Paw Directo**.
4. Elige el servidor/calidad deseada (**Japan-Paw 1080p** o **Japan-Paw 720p**).
5. Pulsa en el episodio para reproducir. El video se transmitirá inmediatamente en tu reproductor preferido de Seanime (MPV o el reproductor web integrado) con sincronización automática de AniSkip y AniList.
