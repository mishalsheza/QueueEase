// B3: the main queries use an index (no COLLSCAN) and need no in-memory
// sort, and scripts/sync_indexes.js brings an older database up to date.
// Plans come from bench/explain.js on a small seeded data set.
const mongoose = require("mongoose");
const Ticket = require("../src/models/Ticket");
const Queue = require("../src/models/Queue");
const { seed, samples, explainAll } = require("../bench/explain");
const { syncIndexes } = require("../scripts/sync_indexes");
const db = require("./helpers/db");

beforeAll(db.connect);
afterAll(db.close);

describe("query plans", () => {
  let rows;
  beforeAll(async () => {
    // Sized like a busy admin (10 queues, ~190 active tickets). With only a
    // few dozen documents the planner can't tell plans apart and may pick
    // an index + in-memory sort, which says nothing about production.
    const data = await seed({ admins: 4, queuesPerAdmin: 10, users: 1000, ticketsPerQueue: 200, waitingPerQueue: 20 });
    rows = await explainAll(await samples(data));
  }, 60000);
  afterAll(db.clear);

  test("covers all 16 main queries", () => {
    expect(rows).toHaveLength(16);
  });

  test("no query scans a whole collection", () => {
    expect(rows.filter((r) => r.scan === "COLLSCAN").map((r) => r.query)).toEqual([]);
  });

  test("no query sorts in memory", () => {
    expect(rows.filter((r) => r.sort !== "-").map((r) => r.query)).toEqual([]);
  });

  test.each([
    ["Queue list (admin)", "admin_1_status_1"],
    ["Admin's queue ids (reports)", "admin_1_status_1"],
    ["Live state of admin's queues", "active_by_queue"],
    ["My active tickets", "active_by_user"],
    ["My history", "user_1_createdAt_-1"],
    ["Users report", "queue_1_createdAt_-1"],
    ["Completed report (top 20)", "queue_1_status_1_completedAt_-1"],
    ["User's waiting ticket", "queue_1_user_1"],
  ])("%s uses %s", (query, index) => {
    expect(rows.find((r) => r.query === query).index).toBe(index);
  });

  test("selective queries read about as many documents as they return", () => {
    // Stats per status reads index keys only (0 documents), so it's excluded.
    const wasteful = rows
      .filter((r) => r.query !== "Stats per status" && r.docs > r.returned + 2)
      .map((r) => `${r.query}: ${r.docs} docs for ${r.returned}`);
    expect(wasteful).toEqual([]);
  });
});

describe("scripts/sync_indexes.js", () => {
  /** An older database: the pre-B3 user index, none of the new ones. */
  async function preB3() {
    await Ticket.collection.dropIndexes();
    await Queue.collection.dropIndexes();
    await Ticket.collection.createIndex({ user: 1, status: 1 }); // user_1_status_1
    await Ticket.collection.createIndex({ queue: 1, status: 1, seq: 1 });
  }

  test("dry run lists the drop and the creates, and changes nothing", async () => {
    await preB3();
    const before = (await Ticket.collection.indexes()).map((i) => i.name).sort();
    const plan = await syncIndexes({ apply: false });

    expect(plan.tickets.drop).toEqual(["user_1_status_1"]);
    expect(plan.tickets.create).toEqual(expect.arrayContaining(["user:1, createdAt:-1", "queue:1, status:1, completedAt:-1"]));
    expect(plan.queues.create).toEqual(expect.arrayContaining(["admin:1, status:1", "status:1"]));
    expect((await Ticket.collection.indexes()).map((i) => i.name).sort()).toEqual(before);
  });

  test("--apply makes the database match the models; a second run has nothing to do", async () => {
    await preB3();
    await syncIndexes({ apply: true });

    const names = (await Ticket.collection.indexes()).map((i) => i.name);
    expect(names).not.toContain("user_1_status_1");
    expect(names).toEqual(expect.arrayContaining(["active_by_queue", "active_by_user", "user_1_createdAt_-1", "one_at_counter_per_queue"]));
    expect((await Queue.collection.indexes()).map((i) => i.name)).toEqual(expect.arrayContaining(["admin_1_status_1", "status_1"]));

    const again = await syncIndexes({ apply: true });
    for (const { create, drop } of Object.values(again)) {
      expect(create).toEqual([]);
      expect(drop).toEqual([]);
    }
  });

  test("never touches documents", async () => {
    const q = await Queue.create({ name: "Keep", admin: new mongoose.Types.ObjectId() });
    await preB3();
    await syncIndexes({ apply: true });
    expect(await Queue.exists({ _id: q._id })).toBeTruthy();
  });
});
