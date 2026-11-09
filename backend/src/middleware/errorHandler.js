const mongoose = require("mongoose");

/**
 * Maps known error types to an HTTP status and a client-safe body.
 * Response shape stays `{ message, code }` because the mobile app reads
 * `err.response.data.message`.
 */
function toHttpError(err) {
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, body: { message: `Invalid ${err.path}`, code: "INVALID_ID" } };
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return {
      status: 400,
      body: {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
      },
    };
  }

  // Two requests modified the same document concurrently. Returning 409 lets
  // the client retry; the underlying race itself is fixed separately.
  if (err instanceof mongoose.Error.VersionError) {
    return {
      status: 409,
      body: { message: "Resource was modified concurrently, please retry", code: "CONFLICT" },
    };
  }

  if (err && err.code === 11000) {
    return { status: 409, body: { message: "Duplicate value", code: "DUPLICATE" } };
  }

  // Malformed JSON request body (thrown by express.json()).
  if (err && err.type === "entity.parse.failed") {
    return { status: 400, body: { message: "Malformed JSON body", code: "BAD_JSON" } };
  }

  return { status: 500, body: { message: "Internal server error", code: "INTERNAL" } };
}

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
function errorHandler(err, req, res, next) {
  const { status, body } = toHttpError(err);

  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }

  if (res.headersSent) {
    // Response already started; let Express close the connection.
    return next(err);
  }

  res.status(status).json(body);
}

function notFound(req, res) {
  res.status(404).json({ message: "Route not found", code: "NOT_FOUND" });
}

module.exports = { errorHandler, notFound, toHttpError };
