/**
 * An error with an HTTP status that is safe to show to the client.
 * errorHandler turns it into `{ message, code }` with that status.
 */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

module.exports = HttpError;
