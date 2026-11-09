const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;

/** Starts a fresh in-memory MongoDB and connects mongoose to it. */
async function connect() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "queueease-test" });
  // Build declared indexes (e.g. unique email) before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

/** Empties every collection between tests. */
async function clear() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

async function close() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

module.exports = { connect, clear, close };
