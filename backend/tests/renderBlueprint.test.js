// render.yaml stays in step with the server: it sets every variable the
// startup check requires, uses the real health route, and holds no secrets.
// (Field names and values were validated against Render's published schema,
// https://render.com/schema/render.yaml.json, when the file was written.)
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/app");

const blueprint = fs.readFileSync(path.join(__dirname, "..", "..", "render.yaml"), "utf8");
const field = (name) => (blueprint.match(new RegExp(`^\\s+${name}: (\\S+)`, "m")) || [])[1];

/** { KEY: "value" | "sync:false" | "generateValue" } for each envVars entry. */
const envVars = Object.fromEntries(
  [...blueprint.matchAll(/- key: (\w+)\n((?:\s+(?!- key)\w+: .*\n?)*)/g)].map(([, key, body]) => {
    if (/sync: false/.test(body)) return [key, "sync:false"];
    if (/generateValue: true/.test(body)) return [key, "generateValue"];
    return [key, (body.match(/value: "?([^"\n]*)"?/) || [])[1]];
  })
);

test("builds and starts the backend with production dependencies only", () => {
  expect(field("rootDir")).toBe("backend");
  expect(blueprint).toMatch(/buildCommand: npm ci --omit=dev/);
  expect(blueprint).toMatch(/startCommand: node src\/server\.js/);
  expect(fs.existsSync(path.join(__dirname, "..", "src", "server.js"))).toBe(true);
});

test("the health check path is a route that answers (not a 404)", async () => {
  expect(field("healthCheckPath")).toBe("/api/health");
  const res = await request(app).get(field("healthCheckPath"));
  expect([200, 503]).toContain(res.status); // 503 here: no database in this test
});

test("sets every variable the startup check requires; Render supplies PORT", () => {
  expect(envVars).toMatchObject({
    MONGO_URI: "sync:false",
    JWT_SECRET: "generateValue",
    CORS_ORIGINS: "sync:false",
    TRUST_PROXY: "1",
    NODE_VERSION: "22",
  });
  expect(envVars.PORT).toBeUndefined();
});

test("a generated JWT_SECRET passes the startup length check", () => {
  // Render's generateValue is a base64-encoded 256-bit value: 44 characters.
  const { loadConfig, MIN_JWT_SECRET_LENGTH } = require("../src/config/env");
  const generated = require("crypto").randomBytes(32).toString("base64");
  expect(generated.length).toBeGreaterThanOrEqual(MIN_JWT_SECRET_LENGTH);
  const { errors } = loadConfig({ MONGO_URI: "mongodb+srv://u:p@c.mongodb.net/queueease", JWT_SECRET: generated, CORS_ORIGINS: "http://localhost:8081", TRUST_PROXY: "1", PORT: "10000" });
  expect(errors).toEqual([]);
});

test("contains no secrets or connection strings", () => {
  expect(blueprint).not.toMatch(/mongodb(\+srv)?:\/\//);
  expect(blueprint).not.toMatch(/JWT_SECRET\s*\n\s+value:/);
});

test("deploys only after CI passes", () => {
  expect(field("autoDeployTrigger")).toBe("checksPass");
});
