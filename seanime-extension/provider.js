/// <reference path="./online-streaming-provider.d.ts" />

class Provider {
  constructor() {
    this.base = "http://127.0.0.1:8790";
  }

  getSettings() {
    return {
      episodeServers: ["Japan-Paw 1080p", "Japan-Paw 720p"],
      supportsDub: false,
    };
  }

  async search(query) {
    let q = "";
    let anilistId = 0;
    if (typeof query === "string") {
      q = query;
    } else if (query && typeof query === "object") {
      q = query.query || query.media?.title?.romaji || query.media?.title?.english || query.media?.title?.userPreferred || "";
      if (query.media?.id) {
        anilistId = Number(query.media.id) || 0;
      }
    }
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (anilistId) params.set("anilistId", String(anilistId));

    const res = await fetch(`${this.base}/seanime/search?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results || [];
  }

  async findEpisodes(id) {
    const res = await fetch(`${this.base}/seanime/episodes?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.episodes || [];
  }

  async findEpisodeServer(episode, server) {
    const episodeId = episode?.id || episode;
    const res = await fetch(`${this.base}/seanime/source?id=${encodeURIComponent(episodeId)}&server=${encodeURIComponent(server || "")}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
}
