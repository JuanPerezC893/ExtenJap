import { readFileSync } from 'node:fs'
import { parseSeries } from './scrape.mjs'
console.log(JSON.stringify(parseSeries(readFileSync(new URL('./ejempl.html', import.meta.url), 'utf8')), null, 2))
