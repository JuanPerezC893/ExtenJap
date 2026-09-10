import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { directUrl } from './direct-url.js'

export function replayJournal(path, state, registry, { repairTail = true } = {}) {
  if (!existsSync(path)) return 0
  const text = readFileSync(path, 'utf8')
  const end = text.lastIndexOf('\n') + 1
  const records = text.slice(0, end).split('\n').filter(Boolean).map(line => {
    const record = JSON.parse(line)
    if (!record.key || !record.job || !record.providers || (record.entry && !record.seriesId)) throw new Error('Registro incremental inválido')
    return record
  })
  for (const record of records) {
    state.jobs[record.key] = record.job
    state.providers = record.providers
    if (record.availabilityKey && record.availability) {
      state.availability ||= {}
      state.availability[record.availabilityKey] = record.availability
    }
    if (record.entry) {
      const series = registry.series[record.seriesId] ||= { title: record.job.series, anilistId: record.job.anilistId ?? null, episodes: [] }
      const index = series.episodes.findIndex(e => (e.sourceFingerprint && e.sourceFingerprint === record.entry.sourceFingerprint) || (Number(e.episode) === Number(record.entry.episode) && String(e.resolution) === String(record.entry.resolution) && directUrl(e.sourceUrl || e.directUrl) === directUrl(record.entry.sourceUrl || record.entry.directUrl)))
      if (index >= 0) series.episodes[index] = record.entry
      else series.episodes.push(record.entry)
    }
  }
  // A killed process may leave an incomplete last append; never join it to the next record.
  if (repairTail && end < text.length) writeFileSync(path, text.slice(0, end))
  return records.length
}

export function appendJournal(path, record) {
  appendFileSync(path, JSON.stringify(record) + '\n')
}
