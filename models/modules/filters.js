// Keep only manga or only novels in a listing/search response.
// NovelCool returns both kinds in the same results, so this filters the page
// that was fetched (a page can therefore end up with fewer items than usual).
export function filterByType(payload, type) {
  if (!type) return payload
  const wanted = String(type).toLowerCase()

  const apply = (section) => {
    const result = section.result.filter(
      (item) => String(item?.type ?? '').toLowerCase() === wanted,
    )
    return {
      ...section,
      result,
      filter: { type: wanted, matched: result.length, scanned: section.result.length },
    }
  }

  if (Array.isArray(payload?.result)) return apply(payload)
  if (Array.isArray(payload?.body?.result)) return { ...payload, body: apply(payload.body) }
  return payload
}
