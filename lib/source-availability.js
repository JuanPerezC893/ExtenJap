import { createWorkGate } from './work-gate.js'
import { directUrl } from './direct-url.js'

export function availabilityKey(series, ep) {
  const url = directUrl(ep.url)
  return JSON.stringify([series.sourceV || series.anilistId || series.id || series.title, url ? new URL(url).hostname : 'invalid'])
}

// A pause is an admission decision for this series/host, not proof that every
// episode is missing. Serialize cheap probes, never the piece verification.
export function createSourceAvailability(states, signal, now = Date.now) {
  const gates = new Map()
  return {
    async run(key, taskKey, action) {
      if (!gates.has(key)) gates.set(key, createWorkGate(1, signal))
      return gates.get(key)(async () => {
        const previous = states[key] || { failures: 0 }
        if (previous.retryAt > now()) return { status: 'deferred', reason: 'SERIES_AVAILABILITY_PAUSE', retryAt: previous.retryAt, availabilitySkipped: true }
        const result = await action()
        if (result?.reason === 'SOURCE_UNAVAILABLE') {
          const failures = previous.retryAt && previous.retryAt <= now() ? 1 : previous.failures + 1
          states[key] = { failures, lastKey: taskKey, retryAt: failures >= 3 ? now() + 6 * 3600000 : 0 }
        } else if (!result) states[key] = { failures: 0, lastKey: taskKey, retryAt: 0 }
        return result
      })
    }
  }
}

export function rotateAvailabilityTasks(tasks, states) {
  const groups = new Map()
  for (const task of tasks) {
    const key = availabilityKey(task.series, task.ep)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(task)
  }
  return [...groups].flatMap(([key, group]) => {
    const state = states[key]
    const index = state?.failures >= 3 ? group.findIndex(t => t.key === state.lastKey) : -1
    return index < 0 ? group : [...group.slice(index + 1), ...group.slice(0, index + 1)]
  })
}
