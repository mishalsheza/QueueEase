const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * Connects mongoose to a fresh database on the run's shared in-memory MongoDB
 * (started once in tests/globalSetup.js). Each test file gets its own
 * database name, so files can't see each other's data.
 */
async function connect() {
  const uri = process.env.TEST_MONGO_URI;
  if (!uri) throw new Error("TEST_MONGO_URI is not set: run tests through jest (see tests/globalSetup.js)");
  await mongoose.connect(uri, { dbName: `queueease-test-${crypto.randomUUID()}` });
  // Build declared indexes (e.g. unique email) before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

/** Empties every collection between tests. */
async function clear() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/** Drops this file's database and disconnects. */
async function close() {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

module.exports = { connect, clear, close };
