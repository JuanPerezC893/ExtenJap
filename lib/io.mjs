import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function readJson(path, fallback = []) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n')
  renameSync(path + '.tmp', path)
}
export const isMain = url => process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href
