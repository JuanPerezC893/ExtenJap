// Preserve IDs, aliases and torrent links only for the identical source file.
export function mergeSeries(previous, incoming) {
  if (!previous) return incoming
  const episodes = incoming.episodes.map(ep => {
    const old = previous.episodes.find(e => e.url === ep.url && Number(e.episode) === Number(ep.episode))
    if (!old) return ep
    return { ...old, ...ep,
      isOnline: ep.checkedAt ? ep.isOnline : old.isOnline ?? null,
      checkedAt: ep.checkedAt || old.checkedAt || null }
  })
  return { ...previous, ...incoming, episodes }
}
