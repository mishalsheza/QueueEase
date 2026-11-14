/**
 * Prints the users and queues in the dev database. Read-only.
 *   node scripts/check_db.js
 * Password hashes are left out.
 */
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const { DB_NAME } = require("../src/config/db");

async function main() {
  require("dotenv").config({ quiet: true });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME });
  try {
    console.log(`--- USERS (${DB_NAME}) ---`);
    console.log(await User.find({}).select("-password").lean());
    console.log("\n--- QUEUES ---");
    console.log(await Queue.find({}).lean());
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
