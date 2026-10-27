# NovelCool API

[![NovelCool API Health Check](https://github.com/tokyo720022-create/Novel-Cool-Api/actions/workflows/novelcool-api-health.yml/badge.svg)](https://github.com/tokyo720022-create/Novel-Cool-Api/actions/workflows/novelcool-api-health.yml)

An **unofficial REST API** that scrapes manga and novel listings, metadata, genres, and chapters (manga page images and novel text) from NovelCool. It uses Node.js, Express, Axios, and Cheerio.

> **Disclaimer:** This is a community project and is not affiliated with or endorsed by NovelCool. It relies on NovelCool's website structure, so source-site changes may cause endpoints to stop working. Use the service responsibly and respect the source site's terms.

## Features

- Browse the manga homepage and latest releases
- Search manga by title or author
- Browse categories and genres
- Retrieve manga details and chapter lists
- Retrieve the page-image URLs for a manga chapter, or the **text of a novel chapter**
- Page through results (`?page=`) and filter by `?type=manga|novel`
- Built-in response cache and rate limiting
- Run automated API smoke checks through GitHub Actions

## Requirements

- Node.js 20 or newer
- npm

## Installation

Clone this repository and install its dependencies:

```bash
git clone https://github.com/tokyo720022-create/Novel-Cool-Api.git
cd Novel-Cool-Api
npm ci
```

Start the development server:

```bash
npm run dev
```

Or run the server directly:

```bash
node index.js
```

The server listens on port `1234` by default. Set the `PORT` environment variable to use a different port.

Local base URL:

```text
http://localhost:1234/api/v1
```

The scraper reads the English NovelCool website (`en.novelcool.com`). NovelCool lists both manga and novels, so every result has a `type` field (`Manga` or `Novel`).

## API Endpoints

All endpoints use HTTP `GET`. Replace the local base URL with your deployed API URL when using a hosted deployment.

| Endpoint | Description |
| --- | --- |
| `/index` | Homepage sections and their manga listings |
| `/lasted` | Latest releases |
| `/complete?page=1` | Completed manga; supports a page query |
| `/romance?page=1` | Romance category |
| `/comedy?page=1` | Comedy category |
| `/drama?page=1` | Drama category |
| `/action?page=1` | Action category |
| `/category/:category?page=1` | Browse a source-site category |
| `/search` | Search and filter manga |
| `/view/:id` | Manga details and chapter list |
| `/info/genres` | Available genres |
| `/reader/:ch/:id` | Manga chapter: page-image URLs |
| `/reader/novel/:ch/:id` | Novel chapter: text, paragraphs and previous/next links |
| `/health` | Server health check (not under `/api/v1`) |

Prefix each path with `/api/v1`. For example:

```http
GET http://localhost:1234/api/v1/lasted
GET http://localhost:1234/api/v1/search?query=One%20Piece
GET http://localhost:1234/api/v1/view/MANGA_ID
```

### Paging and type filter

Listing routes and `/search` accept:

| Parameter | Description |
| --- | --- |
| `page` | Page number, `1`–`1000` (default `1`). The response `pagination` has `currentPage` and `lastPage`. `/lasted` and `/index` are not paged. |
| `type` | `manga` or `novel`. Keeps only that kind of result on the fetched page, so a page may contain fewer items than usual. The response gets `filter: { type, matched, scanned }`. |

```http
GET /api/v1/comedy?page=2&type=manga
GET /api/v1/search?query=One%20Piece&page=2&type=novel
```

### Search parameters

Pass search filters as query parameters to `/api/v1/search`.

| Parameter | Description |
| --- | --- |
| `query` | Search keyword |
| `author` | Author name |
| `s_sel` | Title matching mode: `contain`, `begin`, or `End` |
| `a_sel` | Author matching mode: `contain`, `begin`, or `End` |
| `genres_includes` | Genres to include; multiple values are separated with `%G` (URL-encode the percent sign as `%25`) |
| `genres_not_includes` | Genres to exclude; multiple values are separated with `%G` (URL-encode the percent sign as `%25`) |
| `year` | Publication year |
| `completed` | Completion filter, such as `true` or `false` |
| `rate` | Rating filter |

Example:

```http
GET http://localhost:1234/api/v1/search?query=One%20Piece&author=Oda
```

The search response includes the request filters under `head` and matching manga under `body.result`.

### Manga details

Use an ID returned by a manga listing:

```http
GET http://localhost:1234/api/v1/view/MANGA_ID
```

The detail response includes `bookId`, `title`, `bookType`, `status` (`Ongoing` / `Completed`), `author`, `rate`, `votes`, `description`, `genres`, `chapterCount`, `chaptersList` (each with `chapterId`, `chapterTitle`, `chapterDate`, `url`) and `sourceUrl`. The website does not publish view or follower counts, so those are not returned.

### Read a chapter

Each entry in a detail response's `chaptersList` has a `chapterId` such as `Some-Chapter-Title/4752776`. Split it at the `/` into the two route parameters.

**Novel chapter (text):**

```http
GET /api/v1/reader/novel/Some-Chapter-Title/4752776
```

Returns `title`, `paragraphs` (array), `text` (paragraphs joined with blank lines), `wordCount`, `bookId`, `bookUrl`, `previous` and `next` (each `{ chapterId, url }`, or `null`), and `sourceUrl`. A manga chapter sent to this route gets a `422` explaining that it has no text.

**Manga chapter (images):**

```http
GET /api/v1/reader/CHAPTER_SLUG/CHAPTER_ID
```

Returns chapter information and a list of page-image URLs.

## Caching

Responses are cached in memory (the cache keeps the unfiltered result, so `?type=` changes never cost an extra upstream request). Identical requests that arrive while one is loading share a single NovelCool request, and failures are never cached. Every response has an `X-Cache` header: `HIT`, `MISS`, `COALESCED` or `BYPASS`.

| Content | Default time-to-live |
| --- | --- |
| Index, latest, categories | 5 minutes |
| Search | 5 minutes |
| Details (`/view/:id`) | 10 minutes |
| Chapters (`/reader/...`) | 1 hour |
| Genres | 24 hours |

On serverless hosts such as Vercel each warm instance has its own cache, and it is lost when the instance goes to sleep.

## Rate limiting

Each client IP gets **60 requests per minute** on `/api/v1`, and **10 per minute** on the reader routes (they make many upstream requests). Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. Going over returns `429` with a `Retry-After` header. Separately, the server sends at most **4 requests at a time** to NovelCool (extra requests wait in a queue; if the queue is full you get `503`).

`/health` is not rate limited and reports cache and upstream-queue statistics.

Behind a reverse proxy, set `TRUST_PROXY=1` so the real client IP is used (this is automatic on Vercel). Do not set it when the API is exposed directly, because clients could fake their IP.

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `1234` | Server port |
| `TRUST_PROXY` | off | Number of proxy hops to trust (see above) |
| `RATE_LIMIT_MAX` | `60` | Requests per window per client |
| `RATE_LIMIT_READER_MAX` | `10` | Reader requests per window per client |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Window length |
| `RATE_LIMIT_DISABLED` | off | `1` turns rate limiting off |
| `UPSTREAM_CONCURRENCY` | `4` | Simultaneous requests to NovelCool |
| `UPSTREAM_MAX_QUEUE` | `100` | Waiting requests before `503` |
| `CACHE_DISABLED` | off | `1` turns the cache off |
| `CACHE_MAX_ENTRIES` | `500` | Cache size (least recently used entries are dropped) |
| `CACHE_TTL_LIST`, `CACHE_TTL_SEARCH`, `CACHE_TTL_DETAIL`, `CACHE_TTL_READER`, `CACHE_TTL_GENRES` | see above | Time-to-live in seconds (`0` = don't cache) |

## Errors

Failures return JSON with an HTTP status instead of crashing the server:

| Status | Meaning |
| --- | --- |
| `400` | Invalid manga ID, chapter path, `page` or `type` |
| `404` | Not found on NovelCool |
| `422` | The chapter has no text (a manga chapter sent to the novel reader) |
| `429` | Rate limit exceeded; see `Retry-After` |
| `502` | NovelCool could not be reached or returned an error |
| `503` | Too many requests are waiting on NovelCool; retry shortly |
| `504` | NovelCool took too long to respond |

```json
{ "error": "Could not reach NovelCool.", "status": 502 }
```

## Response for unknown routes

Unknown paths return a JSON response describing the API routes, including:

```json
{
  "message": "route not exist",
  "initRouter": "/api/v1"
}
```

## Automated health checks

The GitHub Actions workflow **NovelCool API Health Check** runs when relevant files are pushed, can be triggered manually, and is scheduled daily. It:

1. Installs dependencies with `npm ci`.
2. Checks JavaScript syntax.
3. Starts the API locally in the runner.
4. Smoke-tests the homepage, latest listings, search, genres, and a manga detail response with chapters.

[View the workflow runs](https://github.com/tokyo720022-create/Novel-Cool-Api/actions)

These checks validate the API running in the GitHub Actions runner; they do not, by themselves, verify that a hosted deployment is available or that every chapter image loads.

## Current limitations

- This is a website scraper, not an official NovelCool API.
- Site HTML, routes, or anti-bot measures can change and break scraping.
- Some routes may require maintenance if the upstream site's category structure changes.
- Search results mix manga and novels; use `?type=` or filter on the `type` field.
- Manga chapter images (`/reader/:ch/:id`) have not been verified against the live English site; run the diagnostic workflow to check.
- Cache and rate-limit counters are per server process, not shared between instances.
- The package currently has no dedicated `npm test` suite; GitHub Actions performs smoke tests instead.
