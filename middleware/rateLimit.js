// Per-client request limiter (fixed window, in memory, no dependencies).
//
// Sends RateLimit-Limit / RateLimit-Remaining / RateLimit-Reset headers and
// answers 429 + Retry-After when a client goes over the limit.
// Like the cache, the counters live in this process only.

const num = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}
const disabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.RATE_LIMIT_DISABLED ?? '').toLowerCase())

export function createRateLimiter({
  windowMs = 60_000,
  max = 60,
  now = Date.now,
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || 'unknown',
  maxClients = 10_000,
} = {}) {
  const clients = new Map() // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const t = now()
    for (const [key, entry] of clients) if (entry.resetAt <= t) clients.delete(key)
  }, Math.max(windowMs, 30_000))
  sweep.unref?.() // never keep the process alive just for this timer

  function middleware(req, res, next) {
    const key = keyGenerator(req)
    const t = now()

    let entry = clients.get(key)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      clients.set(key, entry)
      if (clients.size > maxClients) {
        // Memory guard: forget the oldest clients first.
        for (const oldKey of clients.keys()) {
          if (clients.size <= maxClients) break
          clients.delete(oldKey)
        }
      }
    }

    entry.count += 1
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - t) / 1000))
    res.set('RateLimit-Limit', String(max))
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    res.set('RateLimit-Reset', String(resetSeconds))

    if (entry.count > max) {
      res.set('Retry-After', String(resetSeconds))
      const error = new Error('Too many requests. Please slow down and try again later.')
      error.status = 429
      return next(error)
    }
    return next()
  }

  middleware.stop = () => clearInterval(sweep)
  middleware.size = () => clients.size
  return middleware
}

const passThrough = (req, res, next) => next()
const windowMs = num('RATE_LIMIT_WINDOW_SECONDS', 60) * 1000

// Every /api/v1 route.
export const globalLimiter = disabled
  ? passThrough
  : createRateLimiter({ windowMs, max: num('RATE_LIMIT_MAX', 60) })

// Chapter readers fetch many upstream pages per request, so they get a lower limit.
export const readerLimiter = disabled
  ? passThrough
  : createRateLimiter({ windowMs, max: num('RATE_LIMIT_READER_MAX', 10), keyGenerator: (req) => `reader:${req.ip || req.socket?.remoteAddress || 'unknown'}` })
