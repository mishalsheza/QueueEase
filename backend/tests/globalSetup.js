// Starts ONE in-memory MongoDB for the whole test run. Each test file gets
// its own database on it (tests/helpers/db.js).
//
// Before, every test file started its own mongod on a random free port.
// Occasionally another process took that port between the check and mongod
// binding to it ("Port ... already in use"), and the whole file failed.
const { MongoMemoryServer } = require("mongodb-memory-server");

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  globalThis.__MONGOD__ = mongod; // for globalTeardown
  process.env.TEST_MONGO_URI = mongod.getUri(); // inherited by the test files
};
