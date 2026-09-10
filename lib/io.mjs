import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

export function readJson(path, fallback = []) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n')
  renameSync(path + '.tmp', path)
}
export function isMain(metaUrl) {
  if (!process.argv[1]) return false
  const target = pathToFileURL(resolve(process.argv[1])).href
  if (metaUrl === target) return true
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(metaUrl))
  } catch {
    return false
  }
}
