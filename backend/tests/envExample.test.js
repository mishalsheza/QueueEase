// backend/.env.example documents every variable the server reads, its values
// pass the startup check once the secret is replaced, and it agrees with
// mobile/.env.example.
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { loadConfig } = require("../src/config/env");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const example = dotenv.parse(read(".env.example"));
const exampleText = read(".env.example");
const mobileText = read("../mobile/.env.example");

/** Every env.NAME the startup check reads. */
const checkedVars = [...new Set([...read("src/config/env.js").matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];

test("finds the variables config/env.js reads", () => {
  expect(checkedVars.sort()).toEqual(
    ["AUTH_RATE_LIMIT_MAX", "AUTH_RATE_LIMIT_WINDOW_MIN", "CORS_ORIGINS", "JWT_SECRET", "MONGO_URI", "PORT", "TRUST_PROXY"].sort()
  );
});

test.each(checkedVars)("%s is documented in .env.example", (name) => {
  expect(exampleText).toMatch(new RegExp(`^#?\\s*${name}=`, "m"));
});

test("copied unchanged, the only startup error is the placeholder secret", () => {
  expect(loadConfig(example).errors).toEqual(["JWT_SECRET must be at least 32 characters (it has 10)"]);
});

test("with a real secret, the example passes the startup check with the documented defaults", () => {
  const { errors, config } = loadConfig({ ...example, JWT_SECRET: "x".repeat(48) });
  expect(errors).toEqual([]);
  expect(config).toMatchObject({ port: 5001, corsOrigins: ["http://localhost:8081"], trustProxy: false, authRateLimit: { max: 20, windowMs: 15 * 60 * 1000 } });
});

test("the example contains no real-looking secrets and points at a local database", () => {
  expect(example.MONGO_URI).toBe("mongodb://127.0.0.1:27017");
  expect(example.ADMIN_PASSWORD).toBeUndefined();
  expect(example.NODE_ENV).toBeUndefined(); // NODE_ENV=test would let seed_db wipe a remote DB
  expect(exampleText).not.toMatch(/mongodb\+srv:\/\/(?!<user>)/); // only the <user>:<password> template
});

describe("consistent with mobile/.env.example", () => {
  test("the mobile dev default port is the backend's PORT", () => {
    expect(mobileText).toContain(`http://localhost:${example.PORT}`);
    expect(mobileText).toMatch(new RegExp(`port ${example.PORT}`));
  });

  test("the web origin mobile tells you to allow is the one in CORS_ORIGINS", () => {
    expect(mobileText).toMatch(/add the app's web origin \(e\.g\. http:\/\/localhost:8081\) to\s*#?\s*CORS_ORIGINS in backend\/\.env/);
    expect(example.CORS_ORIGINS.split(",")).toContain("http://localhost:8081");
  });

  test("mobile says the base URL has no /api (the app adds it)", () => {
    expect(mobileText).toMatch(/without \/api/);
  });
});
