// Express 4 does not catch rejected promises from async route handlers.
// Without this wrapper a failed scrape becomes an unhandled rejection,
// which crashes the process on modern Node versions.
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

// Central error handler: turns scraper/network failures into JSON responses
// with sensible status codes instead of crashing or hanging the request.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)

  let status = 500
  let message = 'Internal server error'

  if (err?.isAxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      status = 504
      message = 'NovelCool took too long to respond.'
    } else if (err.response) {
      status = err.response.status === 404 ? 404 : 502
      message =
        err.response.status === 404
          ? 'Not found on NovelCool.'
          : `NovelCool responded with status ${err.response.status}.`
    } else {
      status = 502
      message = 'Could not reach NovelCool.'
    }
  } else if (
    Number.isInteger(err?.status) &&
    ((err.status >= 400 && err.status < 500) || err.status === 503)
  ) {
    // Errors we raise ourselves (bad input, 429 rate limit, 503 busy) are safe to show.
    status = err.status
    message = err.message
  }

  if (status >= 500) console.error(err)

  res.status(status).json({ error: message, status })
}
