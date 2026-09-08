// torrent.js
var BASE_URL = "https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/";
function createTorrentSource(baseUrl = BASE_URL) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith("/")) {
    base.pathname = base.pathname.replace(/[^/]*$/, "");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
  }
  const cache = /* @__PURE__ */ new Map();
  async function loadData(id, fetchFn) {
    const key = `data:${id}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const url = new URL(`data/${id}.json`, base).href;
    try {
      const res = await fetchFn(url);
      if (!res.ok) return null;
      const data = await res.json();
      cache.set(key, { value: data, expires: Date.now() + 3e5 });
      return data;
    } catch {
      return null;
    }
  }
  async function single(query, movie = false) {
    const number = Number(movie ? 1 : query.episode);
    if (!Number.isFinite(number) || number < 0) return [];
    if (!query.anilistId) return [];
    const fetchFn = query.fetch ?? fetch;
    const data = await loadData(query.anilistId, fetchFn);
    if (!data || !Array.isArray(data.episodes)) return [];
    const requested = String(query.resolution || "").replace(/p$/i, "");
    const exclusions = (query.exclusions || []).map((x) => String(x).toLowerCase()).filter(Boolean);
    const matches = data.episodes.filter((ep) => {
      if (Number(ep.episode) !== number) return false;
      if (requested && String(ep.resolution) !== requested) return false;
      const title = ep.fileName || ep.title || "";
      if (exclusions.some((x) => title.toLowerCase().includes(x))) return false;
      return true;
    });
    return matches.map((ep) => {
      const original = ep.fileName || `${data.title} - ${String(ep.episode).padStart(2, "0")} [${ep.resolution}p].mkv`;
      const ext = original.match(/\.[^.]+$/)?.[0] || "";
      const baseName = ext ? original.slice(0, -ext.length) : original;
      return {
        title: `${baseName} [DDL verificado]${ext}`,
        link: new URL(ep.torrent || ep.torrentPath, base).href,
        hash: (ep.hash || ep.infoHash).toLowerCase(),
        size: ep.size,
        date: new Date(ep.verifiedAt || ep.verified?.verifiedAt || 0),
        seeders: 0,
        leechers: 0,
        downloads: 0,
        accuracy: "high"
      };
    });
  }
  return {
    async test() {
      return true;
    },
    single: (query) => single(query),
    movie: (query) => single(query, true),
    async batch() {
      return [];
    }
  };
}
var torrent_default = createTorrentSource();
export {
  createTorrentSource,
  torrent_default as default
};
