// In-memory response cache: TTL + LRU eviction + request coalescing.
//
// - Entries expire after their TTL and the least recently used entry is
//   dropped when the cache is full.
// - If several identical requests arrive while one is loading, they share the
//   same upstream request instead of each hitting NovelCool.
// - Failures are never cached.
//
// Note: the cache lives in this process. On serverless hosts (Vercel) every
// warm instance has its own cache and it is lost when the instance sleeps.

const num = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
const flag = (name) => ['1', 'true', 'yes', 'on'].includes(String(process.env[name] ?? '').toLowerCase())

export function createCache({ maxEntries = 500, now = Date.now, disabled = false } = {}) {
  const store = new Map() // key -> { value, expires }   (Map order = recency)
  const pending = new Map() // key -> Promise of an in-flight load
  const stats = { hits: 0, misses: 0, coalesced: 0, evictions: 0 }

  function read(key) {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expires <= now()) {
      store.delete(key)
      return undefined
    }
    store.delete(key) // move to the "most recent" end
    store.set(key, entry)
    return entry
  }

  function write(key, value, ttlMs) {
    store.delete(key)
    store.set(key, { value, expires: now() + ttlMs })
    while (store.size > maxEntries) {
      store.delete(store.keys().next().value)
      stats.evictions += 1
    }
  }

  // Returns { value, status } where status is HIT, MISS, COALESCED or BYPASS.
  async function cached(key, ttlMs, loader) {
    if (disabled || !(ttlMs > 0)) {
      return { value: await loader(), status: 'BYPASS' }
    }

    const entry = read(key)
    if (entry) {
      stats.hits += 1
      return { value: entry.value, status: 'HIT' }
    }

    if (pending.has(key)) {
      stats.coalesced += 1
      return { value: await pending.get(key), status: 'COALESCED' }
    }

    stats.misses += 1
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        write(key, value, ttlMs)
        return value
      })
      .finally(() => {
        pending.delete(key)
      })
    pending.set(key, promise)

    return { value: await promise, status: 'MISS' }
  }

  return {
    cached,
    clear() {
      store.clear()
    },
    stats() {
      const lookups = stats.hits + stats.misses + stats.coalesced
      return {
        enabled: !disabled,
        entries: store.size,
        maxEntries,
        inFlight: pending.size,
        ...stats,
        hitRate: lookups ? Number(((stats.hits + stats.coalesced) / lookups).toFixed(3)) : 0,
      }
    },
  }
}

// How long each kind of response is kept (seconds, override with env vars).
export const TTL = {
  list: num('CACHE_TTL_LIST', 300) * 1000, // index, latest, categories
  search: num('CACHE_TTL_SEARCH', 300) * 1000,
  detail: num('CACHE_TTL_DETAIL', 600) * 1000, // /view/:id
  reader: num('CACHE_TTL_READER', 3600) * 1000, // chapter pages / text
  genres: num('CACHE_TTL_GENRES', 86400) * 1000,
}

const defaultCache = createCache({
  maxEntries: num('CACHE_MAX_ENTRIES', 500) || 500,
  disabled: flag('CACHE_DISABLED'),
})

export const cached = defaultCache.cached
export const cacheStats = defaultCache.stats
export const clearCache = defaultCache.clear
