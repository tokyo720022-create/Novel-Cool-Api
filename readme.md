# NovelCool API

[![NovelCool API Health Check](https://github.com/tokyo720022-create/novelcool-api/actions/workflows/novelcool-api-health.yml/badge.svg)](https://github.com/tokyo720022-create/novelcool-api/actions/workflows/novelcool-api-health.yml)

An **unofficial REST API** that scrapes manga listings, metadata, genres, and chapter pages from NovelCool. It uses Node.js, Express, Axios, and Cheerio.

> **Disclaimer:** This is a community project and is not affiliated with or endorsed by NovelCool. It relies on NovelCool's website structure, so source-site changes may cause endpoints to stop working. Use the service responsibly and respect the source site's terms.

## Features

- Browse the manga homepage and latest releases
- Search manga by title or author
- Browse categories and genres
- Retrieve manga details and chapter lists
- Retrieve the page-image URLs for a chapter
- Run automated API smoke checks through GitHub Actions

## Requirements

- Node.js 20 or newer
- npm

## Installation

Clone this repository and install its dependencies:

```bash
git clone https://github.com/tokyo720022-create/novelcool-api.git
cd novelcool-api
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
| `/reader/:ch/:id` | Chapter page-image URLs (manga chapters only; novel chapters are text and are not supported) |
| `/health` | Server health check (not under `/api/v1`) |

Prefix each path with `/api/v1`. For example:

```http
GET http://localhost:1234/api/v1/lasted
GET http://localhost:1234/api/v1/search?query=One%20Piece
GET http://localhost:1234/api/v1/view/MANGA_ID
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

The reader route takes the chapter path segment and chapter ID, in that order:

```http
GET http://localhost:1234/api/v1/reader/CHAPTER_SLUG/CHAPTER_ID
```

For example, the route format used by the source scraper is `/reader/Cap-tulo-154/11858129`. The response contains chapter information and a list of page-image URLs.

## Errors

Failures return JSON with an HTTP status instead of crashing the server:

| Status | Meaning |
| --- | --- |
| `400` | Invalid manga ID or chapter path |
| `404` | Not found on NovelCool |
| `502` | NovelCool could not be reached or returned an error |
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

View the [workflow runs](https://github.com/tokyo720022-create/novelcool-api/actions).

These checks validate the API running in the GitHub Actions runner; they do not, by themselves, verify that a hosted deployment is available or that every chapter image loads.

## Current limitations

- This is a website scraper, not an official NovelCool API.
- Site HTML, routes, or anti-bot measures can change and break scraping.
- Some routes may require maintenance if the upstream site's category structure changes.
- Search results mix manga and novels; filter on the `type` field.
- The package currently has no dedicated `npm test` suite; GitHub Actions performs smoke tests instead.
