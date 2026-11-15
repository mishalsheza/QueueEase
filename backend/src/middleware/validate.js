const { ZodError } = require("zod");

/**
 * Validates req.params and req.body against zod schemas before the
 * handler runs. On success the parsed values replace the originals, so
 * handlers only ever see known fields with the right types (unknown body
 * fields such as `role` are dropped). On failure:
 *
 *   400 { message: "Validation failed", code: "VALIDATION_ERROR",
 *         errors: [{ field, message }] }
 *
 * Same shape as Mongoose validation errors in errorHandler, which the app
 * already displays.
 */
const validate = (schemas) => (req, res, next) => {
  const errors = [];
  for (const part of ["params", "body"]) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] === undefined ? {} : req[part]);
    if (result.success) req[part] = result.data;
    else errors.push(...toFieldErrors(result.error));
  }
  if (errors.length > 0) {
    return res.status(400).json({ message: "Validation failed", code: "VALIDATION_ERROR", errors });
  }
  return next();
};

/** zod issues -> [{ field, message }], one per field, in schema order. */
function toFieldErrors(error) {
  if (!(error instanceof ZodError)) return [{ field: "", message: "invalid" }];
  const seen = new Set();
  const out = [];
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "body";
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, message: issue.message });
  }
  return out;
}

module.exports = { validate };
