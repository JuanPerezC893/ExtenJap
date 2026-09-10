// Bound expensive work independently of the number of discovery workers.
export function createWorkGate(concurrency = 2, signal) {
  let active = 0
  const queue = []
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()
      job.cleanup()
      if (signal?.aborted) { job.reject(signal.reason); continue }
      active++
      Promise.resolve().then(job.action).then(job.resolve, job.reject).finally(() => { active--; drain() })
    }
  }
  return action => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const onAbort = () => {
      const index = queue.indexOf(job)
      if (index >= 0) queue.splice(index, 1)
      job.cleanup()
      reject(signal.reason)
    }
    const job = { action, resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) }
    signal?.addEventListener('abort', onAbort, { once: true })
    queue.push(job)
    drain()
  })
}
