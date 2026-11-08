const mongoose = require("mongoose");
const User = require("../src/models/User");
const Queue = require("../src/models/Queue");
require("dotenv").config();

const checkDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to DB");

    const users = await User.find({});
    console.log("\n--- USERS ---");
    console.log(users);

    const queues = await Queue.find({});
    console.log("\n--- QUEUES ---");
    console.log(queues);

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

checkDB();
