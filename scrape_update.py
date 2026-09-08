import json
import re
import os
import sys
import time
from urllib.parse import urlparse, unquote
from bs4 import BeautifulSoup
import requests
from fp.fp import FreeProxy

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CATALOG_FILE = "raw-catalog.json"
START_V = int(sys.argv[1]) if len(sys.argv) > 1 else 7529
END_V = int(sys.argv[2]) if len(sys.argv) > 2 else 8050
VIDEO_EXT = re.compile(r"\.(mkv|mp4|webm|avi|m4v)$", re.I)

current_proxy = None

def get_fresh_proxy():
    global current_proxy
    print("  [Proxy] Buscando proxy fresco (Elite/HTTPS)...")
    for _ in range(5):
        try:
            p = FreeProxy(https=True, elite=True, timeout=2).get()
            if p:
                current_proxy = {"http": p, "https": p}
                print(f"  [Proxy] Conectado via: {p}")
                return current_proxy
        except Exception as e:
            time.sleep(1)
    current_proxy = None
    return None

def fetch_page(v, max_retries=3):
    global current_proxy
    url = f"https://paste.japan-paw.net/?v={v}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://japanpaw.com/",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
    }

    for attempt in range(max_retries):
        try:
            # Si no tenemos proxy, intentar buscar uno
            if not current_proxy:
                get_fresh_proxy()

            res = requests.get(url, headers=headers, proxies=current_proxy, timeout=8)

            # Si Cloudflare o el servidor devuelve 403, rotar proxy
            if res.status_code == 403:
                print(f"  [v={v}] 403 con proxy actual, rotando...")
                get_fresh_proxy()
                continue

            if res.status_code == 404:
                return None

            if res.status_code == 200:
                if "cuenta vip" in res.text or "Iniciar sesion" in res.text or "Iniciar sesión" in res.text:
                    return None
                return res.text

        except Exception:
            get_fresh_proxy()
            time.sleep(1)

    return None

def clean_url(href):
    decoded = href.replace("&amp;", "&")
    try:
        p = urlparse(decoded)
        raw = p.fragment if p.netloc == "redirect.japan-paw.net" else decoded
        if not raw:
            raw = decoded
        raw = re.sub(r"^(https?)%3A%2F%2F", r"\1://", raw, flags=re.I)
        raw = raw.replace("anibatchddl.com", "craftervault.com")
        raw = raw.replace("occi.j-paw.xyz", "occi.craftervault.com")
        return raw
    except Exception:
        return None

def parse_series(html, v):
    soup = BeautifulSoup(html, "html.parser")
    h2 = soup.find("h2")
    title = h2.get_text().strip() if h2 else None
    if not title:
        title_tag = soup.find("title")
        if title_tag:
            title = title_tag.get_text().replace("- Japan-Paw! Descarga Calidad", "").strip()
    if not title:
        return None

    # Mapeo de pestañas a calidad (ej. tab_content_2 -> [Erai-raws][Web 1080p])
    tab_labels = {}
    for li in soup.find_all("li", attrs={"tab-target": True}):
        target = li["tab-target"].lstrip("#")
        span = li.find("span")
        if span:
            tab_labels[target] = span.get_text().strip()

    episodes = []
    # Buscar cada contenedor de tab
    for div in soup.find_all("div", class_=lambda c: c and "tab_content" in c):
        div_id = div.get("id", "")
        quality = tab_labels.get(div_id, "")
        res_match = re.search(r"(\d{3,4})p", quality)
        resolution = res_match.group(1) if res_match else ""

        html_chunk = str(div)
        public_idx = html_chunk.find("Publicos-Paste.png")
        search_chunk = html_chunk[public_idx:] if public_idx >= 0 else html_chunk
        chunk_soup = BeautifulSoup(search_chunk, "html.parser")

        for a in chunk_soup.find_all("a", href=True):
            raw_href = a["href"]
            c_url = clean_url(raw_href)
            if not c_url:
                continue

            file_name = unquote(c_url.split("/")[-1].split("?")[0])
            if not VIDEO_EXT.search(file_name):
                continue

            # Extraer número de episodio
            text = a.get_text().strip()
            ep_match = re.search(r"(?:Cap[íi]tulo|Episodio|Ep\.?)\s*0*(\d+(?:\.\d+)?)", text, re.I) or \
                       re.search(r"(?:[\s\-_]0*(\d{1,4}(?:\.\d+)?)[\s\-_]|E0*(\d{1,4}))", file_name, re.I)
            ep_num = float(ep_match.group(1)) if ep_match else 1.0

            crc_match = re.search(r"\[([0-9A-Fa-f]{8})\]", file_name)
            crc32 = crc_match.group(1).upper() if crc_match else None

            group_match = re.search(r"^\[([^\]]+)\]", file_name)
            group = group_match.group(1) if group_match else None

            if not any(e["url"] == c_url and e["episode"] == ep_num for e in episodes):
                episodes.append({
                    "episode": int(ep_num) if ep_num.is_integer() else ep_num,
                    "resolution": resolution,
                    "quality": quality,
                    "fileName": file_name,
                    "crc32": crc32,
                    "group": group,
                    "url": c_url,
                    "isOnline": True
                })

    return {"sourceV": v, "title": title, "episodes": episodes} if episodes else None

def main():
    print(f"=== ACTUALIZADOR JAPAN-PAW (IDs {START_V}..{END_V}) ===")
    
    catalog = []
    if os.path.exists(CATALOG_FILE):
        with open(CATALOG_FILE, "r", encoding="utf-8") as f:
            catalog = json.load(f)
    print(f"Catalogo cargado: {len(catalog)} series existentes.")

    seen_v = set(s.get("sourceV") for s in catalog if s.get("sourceV") is not None)
    pending_v = [v for v in range(START_V, END_V + 1) if v not in seen_v]
    print(f"Series pendientes en rango: {len(pending_v)}")

    if not pending_v:
        print("No hay series pendientes en este rango.")
        return

    added = 0
    for idx, v in enumerate(pending_v, 1):
        html = fetch_page(v)
        if html:
            parsed = parse_series(html, v)
            if parsed and parsed["episodes"]:
                catalog.append(parsed)
                added += 1
                print(f"[{idx}/{len(pending_v)}] [OK] v={v}: \"{parsed['title']}\" ({len(parsed['episodes'])} eps)")
            else:
                if idx % 10 == 0 or idx == 1:
                    print(f"[{idx}/{len(pending_v)}] v={v}: sin contenido publico reconocible")
        else:
            if idx % 10 == 0 or idx == 1:
                print(f"[{idx}/{len(pending_v)}] v={v}: 404 / privado")

        # Guardar cada 5 series agregadas o cada 25 analizadas
        if (added > 0 and added % 5 == 0) or (idx % 25 == 0):
            catalog.sort(key=lambda s: s.get("sourceV") or 0, reverse=True)
            with open(CATALOG_FILE, "w", encoding="utf-8") as f:
                json.dump(catalog, f, indent=2, ensure_ascii=False)

    catalog.sort(key=lambda s: s.get("sourceV") or 0, reverse=True)
    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"\nActualizacion completada: {added} nuevas series anadidas al catalogo.")

if __name__ == "__main__":
    main()
