// Diagnostic for the NovelCool scraper.
// Fetches the same pages the API scrapes, saves the raw HTML, and reports
// which CSS selectors match. Run it from the "Diagnose NovelCool Scraping"
// workflow (or locally: DIAG_QUERIES="One Piece" node scripts/diagnose.js).
//
// Env: DIAG_QUERIES  titles separated by "|"   (a control title is always added)
//      DIAG_ID       optional exact manga ID to inspect

import axios from 'axios'
import * as cheerio from 'cheerio'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://en.novelcool.com/'
const OUT = path.resolve('diagnostics')
const CONTROL = 'One Piece' // well-known title: tells "scraper broken" from "this title is special"

// Same request settings as models/mangas.js
const REQUEST = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  timeout: 25000,
  maxRedirects: 5,
}

const SIGNALS = {
  'cloudflare challenge': /just a moment|cf-chl|challenge-platform|cf-browser-verification/gi,
  captcha: /captcha/gi,
  'age/adult wording': /over 18|18\+|age verif|adult content/gi,
  'access denied': /access denied|403 forbidden|you have been blocked/gi,
  'needs javascript': /enable javascript|requires javascript/gi,
}

const DETAIL_GROUPS = {
  title: [
    '.bk-side-intro .bk-side-intro-most .bookinfo-title',
    '.bookinfo-title',
    '.book-title',
    'h1',
  ],
  author: ['.bookinfo-author a span', '.bookinfo-author a', '.book-author'],
  stats: [
    '.for-pc .bk-data .bk-data-val',
    '.bk-data .bk-data-val',
    '.book-data-item .book-data-num',
  ],
  description: [
    '.bk-summary .bk-summary-txt',
    '.bookinfo-summary',
    '.bookinfo-desc',
    '.book-intro',
    '.book-summary-content',
    '[itemprop="description"]',
    'meta[name="description"]',
    'meta[property="og:description"]',
  ],
  genres: [
    '.for-pc .bk-cates .bookinfo-category-list > .bk-cate-item',
    '.bookinfo-category-list a',
    '.bk-cates a',
    '.book-tags .book-tag',
  ],
  chapters: [
    '.chapter-item-list .chp-inner-ls > .chp-item',
    '.chapter-item-list .chp-item',
    '.chapter-list .chapter-item',
    '.chapter-list li',
    '.chapter-list-item',
    'a[href*="/chapter/"]',
  ],
}

const READER_GROUPS = {
  images: [
    '.mangaread-img .pic_box img',
    '.mangaread-img img',
    '.read-content img',
    '.chapter-content img',
    '.reading-content img',
  ],
  'page selector': [
    '.mangaread-page .mangaread-pagenav .sl-page option',
    '.mangaread-pagenav .sl-page option',
  ],
  title: ['.mangaread-title', '.chapter-title', 'h1'],
}

// ---------- helpers ----------
const lines = []
const log = (s = '') => {
  console.log(s)
  lines.push(String(s))
}
const clip = (v, n = 60) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'
const unique = (arr) => [...new Set(arr)]
const isPlaceholder = (t) => !t || /^(n\s*\/?\s*a|none|null|unknown|-)$/i.test(t.trim())

const summary = { search: [], detail: [] }

async function fetchPage(label, url) {
  let res
  try {
    res = await axios.get(url, {
      ...REQUEST,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: (d) => d,
    })
  } catch (err) {
    log(`FETCH ${label}: ERROR ${err.code || err.message}`)
    return null
  }

  const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  const finalUrl = res.request?.res?.responseUrl || url
  await fs.writeFile(path.join(OUT, `${label}.html`), html)

  const $ = cheerio.load(html)
  log(`FETCH ${label}`)
  log(`  url:    ${clip(url, 110)}`)
  if (finalUrl !== url) log(`  final:  ${clip(finalUrl, 110)}`)
  log(`  status: ${res.status}  size: ${html.length} bytes`)
  log(`  server: ${res.headers?.server ?? '-'}  cf-ray: ${res.headers?.['cf-ray'] ? 'yes' : 'no'}`)
  log(`  <title>: ${clip($('title').first().text(), 80)}`)

  const hits = Object.entries(SIGNALS)
    .map(([name, re]) => [name, (html.match(re) || []).length])
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}=${n}`)
  log(`  signals: ${hits.length ? hits.join(', ') : 'none'}`)
  log(`  .site-content=${$('.site-content').length}  .book-item=${$('.book-item').length}`)
  return { $, html, status: res.status }
}

function probe($, groups) {
  for (const [name, selectors] of Object.entries(groups)) {
    log(`  ${name}:`)
    for (const sel of selectors) {
      let n = 0
      let sample = ''
      try {
        const els = $(sel)
        n = els.length
        if (n) {
          sample = sel.startsWith('meta')
            ? els.first().attr('content')
            : els.first().text()
        }
      } catch {
        n = 'bad selector'
      }
      log(`   ${String(n).padStart(3)}  ${sel}${sample ? '  ->  ' + clip(sample, 50) : ''}`)
    }
  }
}

function firstFilled($, selectors) {
  for (const sel of selectors) {
    try {
      const els = $(sel)
      for (let i = 0; i < els.length; i += 1) {
        const node = els.eq ? els.eq(i) : els.first()
        const t = sel.startsWith('meta') ? node.attr('content') : node.text()
        if (!isPlaceholder(String(t ?? '').replace(/\s+/g, ' ')) && String(t).trim().length >= 2) {
          return String(t).replace(/\s+/g, ' ').trim()
        }
      }
    } catch {
      /* ignore bad selector */
    }
  }
  return ''
}

function maxCount($, selectors) {
  let best = 0
  for (const sel of selectors) {
    try {
      best = Math.max(best, $(sel).length)
    } catch {
      /* ignore */
    }
  }
  return best
}

function listCards($, max = 20) {
  const cards = $('.site-content .category-book-list .book-item')
  const items = []
  cards.each((i, el) => {
    if (i >= max) return false
    const card = $(el)
    const href = card.find('.book-pic a').attr('href') || ''
    const id = (href.match(/\/([^/]+)\.html$/) || [])[1] || ''
    items.push({
      id,
      type: clip(card.find('.book-pic .book-type').first().text(), 10),
      title: clip(card.find('.book-info .book-name').first().text(), 50),
    })
    return undefined
  })
  return { total: cards.length, items }
}

// Prefer a Manga result: the API's reader only supports image chapters.
const pickResult = (items) => items.find((it) => it.id && /manga/i.test(it.type)) || items.find((it) => it.id)

const searchUrl = (name) =>
  new URL(
    'search/?' +
      new URLSearchParams({
        name_sel: 'contain',
        name,
        author_sel: 'contain',
        author: '',
        category_id: ',',
        out_category_id: ',',
        publish_year: '',
        completed_series: '',
        rate_star: '',
      }).toString(),
    BASE,
  ).href

// ---------- steps ----------
async function runSearch(query) {
  log('')
  log(`=== SEARCH: "${query}" ===`)
  const longestWord = query.split(/\s+/).sort((a, b) => b.length - a.length)[0] || ''
  const variants = unique([query, query.split(/\s+/).slice(0, 3).join(' '), longestWord]).filter(
    (v) => v.length >= 3,
  )

  const counts = []
  let firstId = ''
  for (const [i, v] of variants.entries()) {
    await sleep(800)
    const page = await fetchPage(`search-${slug(query)}-${i}`, searchUrl(v))
    if (!page) {
      counts.push('err')
      continue
    }
    const { total, items } = listCards(page.$)
    const present = page.html.toLowerCase().includes(v.toLowerCase())
    log(`  variant "${clip(v, 40)}": ${total} card(s); text in HTML: ${present ? 'yes' : 'no'}`)
    items.slice(0, 6).forEach((it) => log(`    - [${it.type || '?'}] ${it.title} (${it.id || 'no id'})`))
    counts.push(String(total))
    if (!firstId) firstId = pickResult(items)?.id || ""
  }
  summary.search.push(`"${clip(query, 38)}" -> cards per variant: ${counts.join(' / ')}`)
  return firstId
}

async function runDetail(label, id) {
  log('')
  log(`=== DETAIL: ${label} [${id}] ===`)
  await sleep(800)
  const page = await fetchPage(
    `detail-${slug(label)}`,
    new URL(`novel/${encodeURIComponent(id)}.html`, BASE).href,
  )
  if (!page) return null
  const { $, html } = page

  probe($, DETAIL_GROUPS)

  const chapterLinks = []
  $('.chp-item a[href], a[href*="/chapter/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    // skip the empty "Start Reading" placeholder ("/chapter//.html")
    if (/\/chapter\/[^/]+\/?/.test(href) && !/\/chapter\/\/?\.html/.test(href) && chapterLinks.length < 3) {
      chapterLinks.push(href)
    }
    return undefined
  })

  const mentions = (html.match(/\/chapter\//gi) || []).length
  log(`  raw "/chapter/" mentions in HTML: ${mentions}; <a> links: ${maxCount($, ['a[href*="/chapter/"]'])}`)

  const hintRe = /["'`]([^"'`\s]{0,80}(?:ajax|chapter_?list|get_?chapter|chapters?\.json|\/api\/)[^"'`\s]{0,60})["'`]/gi
  const hints = unique([...html.matchAll(hintRe)].map((m) => m[1])).slice(0, 8)
  log(`  possible dynamic-loading hints: ${hints.length ? '' : 'none'}`)
  hints.forEach((h) => log(`    ${clip(h, 100)}`))

  summary.detail.push(
    [
      `${clip(label, 24)} [${clip(id, 30)}]`,
      `type=${firstFilled($, ['.book-type']) || '?'}`,
      `title=${firstFilled($, DETAIL_GROUPS.title) ? 'ok' : 'MISSING'}`,
      `author=${firstFilled($, DETAIL_GROUPS.author) ? 'ok' : 'MISSING'}`,
      `desc=${firstFilled($, DETAIL_GROUPS.description) ? 'ok' : 'MISSING'}`,
      `genres=${maxCount($, DETAIL_GROUPS.genres)}`,
      `stats=${maxCount($, DETAIL_GROUPS.stats)}`,
      `chapters=${maxCount($, ['.chapter-item-list .chp-item'])}`,
      `real-links=${chapterLinks.length ? 'yes' : 'none'}`,
    ].join('  '),
  )
  return { chapterLinks }
}

async function runReader(label, href) {
  log('')
  log(`=== READER: ${label} ===`)
  await sleep(800)
  const url = new URL(href, BASE).href
  const page = await fetchPage(`reader-${slug(label)}`, url)
  if (!page) return
  probe(page.$, READER_GROUPS)

  // Also try the URL the API itself builds for /reader/:ch/:id
  // (models/mangas.js -> chapter/<slug>/<id>-10-1.html).
  const rest = (url.split(/\/chapter\//i)[1] || '').replace(/\/+$/, '').replace(/\.html?$/i, '')
  if (rest) {
    log('')
    log('  -- API-style URL (same pattern as /reader/:ch/:id) --')
    await sleep(800)
    const apiPage = await fetchPage(`reader-api-url-${slug(label)}`, new URL(`chapter/${rest}-10-1.html`, BASE).href)
    if (apiPage) probe(apiPage.$, { images: READER_GROUPS.images, 'page selector': READER_GROUPS['page selector'] })
  }
}

async function runGenres() {
  log('')
  log('=== GENRES PAGE (used by /info/genres) ===')
  const page = await fetchPage('genres', new URL('category/1947.html', BASE).href)
  if (!page) return
  probe(page.$, {
    genres: ['.category-group .category-list > a', '.category-list > .category-id-item'],
    pagination: ['.page-navone .select', '.page-navone .page-nav-center-num'],
  })
}

// ---------- main ----------
async function main() {
  await fs.mkdir(OUT, { recursive: true })

  log(`NovelCool scraper diagnostics - ${new Date().toISOString()}`)
  log(`base: ${BASE}  node: ${process.version}`)

  const queries = unique([
    CONTROL,
    ...String(process.env.DIAG_QUERIES || '')
      .split(/[|\n]/)
      .map((q) => q.trim())
      .filter(Boolean),
  ])

  log('')
  log('=== HOMEPAGE ===')
  const home = await fetchPage('homepage', BASE)
  if (home) probe(home.$, { sections: ['.index-book-list', '.site-content .category-book-list .book-item'] })

  let readerHref = ''
  for (const query of queries) {
    const id = await runSearch(query)
    if (!id) continue
    const detail = await runDetail(query, id)
    if (!readerHref && detail?.chapterLinks?.[0]) readerHref = detail.chapterLinks[0]
  }

  const manualId = String(process.env.DIAG_ID || '').trim()
  if (manualId) {
    const detail = await runDetail('manual-id', manualId)
    if (!readerHref && detail?.chapterLinks?.[0]) readerHref = detail.chapterLinks[0]
  }

  await runGenres()

  if (readerHref) await runReader('first chapter found', readerHref)
  else {
    log('')
    log('=== READER: skipped (no chapter link found on any detail page) ===')
  }

  log('')
  log('================ SUMMARY ================')
  summary.search.forEach((s) => log(s))
  summary.detail.forEach((s) => log(s))
  log('')
  log('How to read this:')
  log('- If the control (One Piece) also shows chapters=0 / stats=0, the')
  log('  selectors or the fetched HTML are wrong for ALL titles.')
  log('- If only your titles are empty, those entries are special')
  log('  (different entry, age-gated, or hidden from search).')
  log('- Open diagnostics/*.html (workflow artifact) to see the raw pages.')
}

try {
  await main()
} catch (err) {
  log(`SCRIPT ERROR: ${err?.stack || err}`)
  process.exitCode = 1
} finally {
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(OUT, 'report.txt'), lines.join('\n') + '\n')
}
