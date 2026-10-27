// Limits how many requests we send to NovelCool at the same time, so one busy
// moment on this API cannot turn into a flood against the upstream site.

const positive = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function createLimiter({ maxConcurrent = 4, maxQueue = 100 } = {}) {
  let active = 0
  const queue = []

  function drain() {
    while (active < maxConcurrent && queue.length) {
      const { task, resolve, reject } = queue.shift()
      active += 1
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1
          drain()
        })
    }
  }

  function run(task) {
    return new Promise((resolve, reject) => {
      if (queue.length >= maxQueue) {
        const error = new Error('The server is busy talking to NovelCool. Try again shortly.')
        error.status = 503
        reject(error)
        return
      }
      queue.push({ task, resolve, reject })
      drain()
    })
  }

  run.stats = () => ({ active, queued: queue.length, maxConcurrent, maxQueue })
  return run
}

export const upstream = createLimiter({
  maxConcurrent: positive('UPSTREAM_CONCURRENCY', 4),
  maxQueue: positive('UPSTREAM_MAX_QUEUE', 100),
})
