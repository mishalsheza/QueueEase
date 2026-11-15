/**
 * Makes the database's indexes match the models (plan item B3).
 *
 *   node scripts/sync_indexes.js           # dry run: lists what would change
 *   node scripts/sync_indexes.js --apply   # creates missing, drops outdated
 *
 * Mongoose creates missing indexes on startup, but it never drops one.
 * B3 replaces tickets.user_1_status_1 (now covered by the new user indexes),
 * and that needs an explicit drop. Never touches documents, only indexes.
 * Safe to run more than once. Run the dry run first: "drop" lists every
 * index in the database that no model declares, including any you created
 * by hand.
 */
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
const Ticket = require("../src/models/Ticket");
const { DB_NAME } = require("../src/config/db");

const MODELS = [User, Queue, Ticket];

const describe = (keys) => Object.entries(keys).map(([k, v]) => `${k}:${v}`).join(", ");

/** { collection: { create: [...], drop: [...] } } and, with apply, does it. */
async function syncIndexes({ apply }) {
  const plan = {};
  for (const model of MODELS) {
    const { toCreate, toDrop } = await model.diffIndexes();
    plan[model.collection.collectionName] = {
      create: toCreate.map((keys) => describe(keys)),
      drop: toDrop,
    };
    if (apply && (toCreate.length || toDrop.length)) {
      await model.syncIndexes();
    }
  }
  return plan;
}

async function main() {
  require("dotenv").config({ quiet: true });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  const apply = process.argv.includes("--apply");

  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME, autoIndex: false });
  try {
    const plan = await syncIndexes({ apply });
    console.log(`${apply ? "Synced" : "Dry run (nothing changed), would sync"} indexes in "${DB_NAME}":`);
    for (const [coll, { create, drop }] of Object.entries(plan)) {
      if (!create.length && !drop.length) {
        console.log(`  ${coll}: up to date`);
        continue;
      }
      create.forEach((c) => console.log(`  ${coll}: create { ${c} }`));
      drop.forEach((d) => console.log(`  ${coll}: drop ${d}`));
    }
    if (!apply) console.log("Re-run with --apply to make these changes.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { syncIndexes };
