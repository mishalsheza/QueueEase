/**
 * Request schemas for every route that takes input. Used with
 * middleware/validate.js. Messages are short because the app shows them as
 * "<field>: <message>".
 */
const { z } = require("zod");

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/** A string field: rejects objects/arrays/numbers, which is what stops NoSQL operators. */
const str = () => z.string({ required_error: "is required", invalid_type_error: "must be a string" });

const objectId = () => str().regex(OBJECT_ID, "must be a valid id");

// bcrypt only uses the first 72 bytes of a password, so longer ones are
// rejected instead of being silently truncated.
const newPassword = () => str().min(6, "must be at least 6 characters").max(72, "must be at most 72 characters");

const schemas = {
  register: {
    body: z.object({
      name: str().trim().min(1, "is required").max(100, "must be at most 100 characters"),
      email: str().trim().min(1, "is required").max(254, "is too long").email("must be a valid email"),
      password: newPassword(),
    }),
  },

  login: {
    // Only presence and type: telling the user "too short" here would leak
    // nothing, but it would also lock out accounts made under older rules.
    body: z.object({
      email: str().min(1, "is required").max(254, "is too long"),
      password: str().min(1, "is required").max(1024, "is too long"),
    }),
  },

  queueId: { params: z.object({ queueId: objectId() }) },

  createQueue: {
    body: z.object({
      name: str().trim().min(1, "is required").max(100, "must be at most 100 characters"),
      type: str().trim().min(1, "can't be empty").max(50, "must be at most 50 characters").optional(),
      section: z.enum(["A", "B", "C", "D"], { errorMap: () => ({ message: "must be A, B, C or D" }) }).optional(),
      graceMinutes: z
        .number({ invalid_type_error: "must be a number" })
        .int("must be a whole number")
        .min(1, "must be from 1 to 120")
        .max(120, "must be from 1 to 120")
        .optional(),
    }),
  },

  // serve / no-show: optional id of the ticket the admin is acting on.
  atCounter: { body: z.object({ ticketId: objectId().optional() }) },

  setStatus: {
    body: z.object({
      status: z.enum(["open", "paused"], {
        errorMap: () => ({ message: 'must be "open" or "paused" (use close to close a queue)' }),
      }),
    }),
  },

  settings: {
    body: z.object({
      graceMinutes: z
        .number({ required_error: "is required", invalid_type_error: "must be a number" })
        .int("must be a whole number")
        .min(1, "must be from 1 to 120")
        .max(120, "must be from 1 to 120"),
    }),
  },
};

module.exports = { schemas, OBJECT_ID };
