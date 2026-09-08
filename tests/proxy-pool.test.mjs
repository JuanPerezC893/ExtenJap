import test from 'node:test'
import assert from 'node:assert/strict'
import { ProxyPool } from '../lib/proxy-pool.js'

test('proxy-pool: pool deshabilitado realiza fetch nativo directo', async () => {
  const pool = new ProxyPool({ enabled: false })
  const res = await pool.fetch('data:text/plain;charset=utf-8,hello-direct')
  const text = await res.text()
  assert.equal(text, 'hello-direct')
})

test('proxy-pool: rotación round-robin de proxies', () => {
  const pool = new ProxyPool({ enabled: true })
  pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080', 'http://proxy3:8080']
  
  assert.equal(pool.getNextProxy(), 'http://proxy1:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy2:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy3:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy1:8080')
})

test('proxy-pool: markFailure elimina proxy defectuoso del pool', () => {
  const pool = new ProxyPool({ enabled: true })
  pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080']
  
  pool.markFailure('http://proxy1:8080')
  assert.deepEqual(pool.workingProxies, ['http://proxy2:8080'])
  assert.equal(pool.getNextProxy(), 'http://proxy2:8080')
})

test('proxy-pool: fallback a directo si fallan reintentos y strictProxy es falso', async () => {
  const pool = new ProxyPool({ enabled: true, strictProxy: false, maxRetries: 1 })
  pool.workingProxies = ['http://127.0.0.1:59999'] // puerto cerrado para provocar fallo
  
  const res = await pool.fetch('data:text/plain;charset=utf-8,fallback-success')
  const text = await res.text()
  assert.equal(text, 'fallback-success')
})
