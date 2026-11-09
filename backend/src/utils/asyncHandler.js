/**
 * Wraps an async Express handler so a rejected promise is passed to next(err).
 *
 * Express 4 does not catch async errors itself: without this, a rejection
 * (e.g. a CastError from a bad ObjectId) becomes an unhandledRejection and
 * Node terminates the whole process.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
