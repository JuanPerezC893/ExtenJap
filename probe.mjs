import { readJson } from './lib/io.mjs'
import { probe } from './hash.mjs'
const series = readJson('raw-catalog.json').find(s => s.sourceV === Number(process.argv[2] ?? 7901))
const episode = series?.episodes.find(e => e.episode === Number(process.argv[3] ?? 1) && e.resolution === (process.argv[4] ?? '720'))
if (!episode) throw new Error('Episodio no encontrado en raw-catalog.json')
try { console.log(JSON.stringify({ title: series.title, episode: episode.episode, resolution: episode.resolution, ...await probe(episode.url) }, null, 2)) }
catch (error) { console.error(error.message, error.cause?.message ?? ''); process.exitCode = 1 }
