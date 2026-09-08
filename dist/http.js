// lib/catalog.js
function catalogLoader(url) {
  let cached, expires = 0, pending;
  return async (fetchFn, refresh = false) => {
    if (!refresh && cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(15e3) });
      if (!response.ok) throw new Error(`Cat\xE1logo: HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data) || data.some((s) => !s.title || !Array.isArray(s.episodes))) throw new Error("Cat\xE1logo inv\xE1lido");
      cached = data;
      expires = Date.now() + 3e5;
      return data;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

// lib/matching.js
var VIDEO = /\.(mkv|mp4|webm|avi|m4v)$/i;
var normalize = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
var crc = (value) => String(value ?? "").match(/\[([a-f\d]{8})\]/i)?.[1].toUpperCase();
var resolution = (value) => String(value ?? "").match(/(?:^|[^\d])(2160|1080|720|540|480)p?(?=$|[^\d])/i)?.[1];
function fileName(ep) {
  try {
    const name = decodeURIComponent(new URL(ep.url).pathname.split("/").pop());
    if (VIDEO.test(name)) return name;
  } catch {
  }
  return ep.fileName || "";
}
var canonicalFile = (value) => String(value ?? "").normalize("NFC").toLowerCase().trim();
function episodeNumber(value) {
  const text = String(value ?? "").replace(/\[[^\]]*\]/g, " ");
  const tagged = text.match(/(?:\bS\d+[ ._-]*)?\b(?:E|EP|Episode)[ ._-]*0*(\d+(?:\.\d+)?)(?=\b|v\d)/i) ?? text.match(/\bS\d+E0*(\d+(?:\.\d+)?)(?=\b|v\d)/i);
  if (tagged) return Number(tagged[1]);
  const separated = text.match(/\s-\s*0*(\d{1,3}(?:\.\d+)?)(?:v\d+)?(?=\s|\.[a-z]|$)/i);
  return separated ? Number(separated[1]) : null;
}
function seasonNumber(value) {
  const text = String(value ?? "");
  const match = text.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ?? text.match(/\bseason\s*(\d+)\b/i) ?? text.match(/\bS0*(\d+)(?:E\d+|\b)/i);
  if (match) return Number(match[1]);
  const roman = text.match(/\b(II|III|IV|V)\s*$/);
  return roman ? { II: 2, III: 3, IV: 4, V: 5 }[roman[1]] : 1;
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
    row = next;
  }
  return row[b.length];
}
function matchSeries(catalog, titles = [], id) {
  const byId = id ? catalog.filter((s) => Number(s.anilistId) === Number(id)) : [];
  if (byId.length) return byId;
  const available = catalog.filter((s) => !id || !s.anilistId);
  const wanted = titles.filter((t) => normalize(t));
  const names = (s) => [s.title, ...s.aliases ?? []].filter(Boolean);
  const exact = available.filter((s) => names(s).some((n) => wanted.some((t) => normalize(n) === normalize(t))));
  if (exact.length) return exact;
  const fuzzy = available.filter((s) => names(s).some((n) => wanted.some((t) => {
    const a = normalize(n), b = normalize(t);
    return a.length >= 6 && b.length >= 6 && seasonNumber(n) === seasonNumber(t) && editDistance(a, b) <= 1;
  })));
  return fuzzy.length === 1 ? fuzzy : [];
}
function sameRelease(ep, name) {
  const expected = fileName(ep);
  if (!expected || !name) return false;
  const aCrc = crc(expected) || ep.crc32?.toUpperCase(), bCrc = crc(name);
  if (aCrc && bCrc && aCrc !== bCrc) return false;
  const aRes = resolution(expected) || String(ep.resolution || ""), bRes = resolution(name);
  if (aRes && bRes && aRes !== bRes) return false;
  const aEp = episodeNumber(expected), bEp = episodeNumber(name);
  if (aEp !== null && bEp !== null && aEp !== bEp) return false;
  const codec = (text) => /\b(hevc|x265|h[ .]?265)\b/i.test(text) ? "hevc" : /\b(avc|x264|h[ .]?264)\b/i.test(text) ? "avc" : null;
  if (codec(expected) && codec(name) && codec(expected) !== codec(name)) return false;
  if (canonicalFile(expected) === canonicalFile(name)) return true;
  const core = (value) => normalize(value.replace(/\[[^\]]*\]/g, "").replace(/\.(mkv|mp4|webm|avi|m4v)$/i, ""));
  if (Boolean(aCrc && bCrc && aCrc === bCrc && core(expected) && core(expected) === core(name))) return true;
  const group = (text) => String(text).match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase();
  const aGroup = ep.group?.toLowerCase() || group(expected), bGroup = group(name);
  if (aGroup && bGroup && aGroup === bGroup && core(expected) && core(expected) === core(name)) return true;
  return false;
}
function onlineState(ep, now = Date.now()) {
  const checked = Date.parse(ep.checkedAt);
  if (!Number.isFinite(checked) || checked > now || now - checked > 864e5) return null;
  return typeof ep.isOnline === "boolean" ? ep.isOnline : null;
}

// http.js
var INDEX_URL = "https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/indexed-catalog.json";
function resolveFile(query, file, catalog, batch = false) {
  if (!file?.name || !VIDEO.test(file.name)) return void 0;
  const series = matchSeries(catalog, query.titles, query.anilistId);
  const candidates = [];
  const number = batch ? episodeNumber(file.name) : Number(query.episode);
  for (const s of series) {
    for (const ep of s.episodes || []) {
      if (number !== null && Number.isFinite(number) && Number(ep.episode) !== number) continue;
      if (!sameRelease(ep, file.name) || onlineState(ep) === false) continue;
      try {
        if (!["http:", "https:"].includes(new URL(ep.url).protocol)) continue;
      } catch {
        continue;
      }
      candidates.push(ep);
    }
  }
  if (!candidates.length) return void 0;
  const exact = candidates.filter((ep) => fileName(ep) === file.name);
  const chosen = exact.length ? exact : candidates;
  if (new Set(chosen.map((ep) => fileName(ep))).size > 1) return void 0;
  return { url: chosen[0].url, index: file.index };
}
function createHTTPSource(indexUrl = INDEX_URL) {
  const load = catalogLoader(indexUrl);
  return {
    async test() {
      await load(fetch, true);
      return true;
    },
    async single(query) {
      return resolveFile(query, query.file, await load(query.fetch ?? fetch));
    },
    async batch(query) {
      const catalog = await load(query.fetch ?? fetch);
      return (query.files || []).map((file) => resolveFile(query, file, catalog, true)).filter(Boolean);
    }
  };
}
var http_default = createHTTPSource();
export {
  createHTTPSource,
  http_default as default,
  resolveFile
};
