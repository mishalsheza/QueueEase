const jwt = require("jsonwebtoken");
const User = require("../../src/models/User");
const Queue = require("../../src/models/Queue");

let counter = 0;

/**
 * Creates a user directly in the DB and returns { user, token, auth }.
 * Admins are created here rather than via /register so tests keep working
 * once self-registration as admin is blocked.
 */
async function createUser({ role = "user", name } = {}) {
  counter += 1;
  const user = await User.create({
    name: name || `${role} ${counter}`,
    email: `${role}${counter}@test.com`,
    password: "secret123",
    role,
  });
  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  return { user, token, auth: `Bearer ${token}` };
}

async function createQueue(admin, fields = {}) {
  return Queue.create({ name: "Clinic", admin: admin._id, ...fields });
}

module.exports = { createUser, createQueue };
