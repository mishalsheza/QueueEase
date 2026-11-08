const mongoose = require("mongoose");

const queueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      default: 'General Checkup'
    },
    section: {
      type: String,
      default: 'A'
    },
    users: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    servedToday: {
      type: Number,
      default: 0
    },
    avgProcessTime: {
      type: Number,
      default: 15
    },
    nowServing: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      token: String,
      startedAt: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Queue", queueSchema);
