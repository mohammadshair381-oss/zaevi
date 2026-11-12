/**
 * 404 and error-handling middleware.
 */

/**
 * Error carrying an intended HTTP status code. Route handlers throw these and
 * the error handler below turns them into the standardized JSON error body.
 */
export class HttpError extends Error {
  constructor(status, message = 'Error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function notFoundHandler() {
  return function notFound(req, res) {
    res.status(404);
    // Use originalUrl: when this handler is mounted at `/api`, req.path is
    // relative to the mount point and no longer starts with `/api`.
    if (req.originalUrl === '/api' || req.originalUrl.startsWith('/api/')) {
      return res.json({
        error: { status: 404, message: 'Not Found', path: req.originalUrl },
      });
    }
    return res.type('text/plain').send('Not Found');
  };
}

export function errorHandler({ logger = console } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function handleError(err, req, res, next) {
    const status = Number(err.status || err.statusCode) || 500;
    const isServerError = status >= 500;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isServerError) {
      logger.error(`[error] ${req.method} ${req.originalUrl}`, err);
    }

    const message = isServerError && isProduction ? 'Internal Server Error' : err.message || 'Error';

    const body = { error: { status, message } };
    if (isServerError && !isProduction) {
      body.error.stack = err.stack;
    }

    res.status(status).json(body);
  };
}
