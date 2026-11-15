// Static checks on the Docker setup. The CI "docker" job runs the real thing
// (docker compose up --wait); these catch mistakes that would still start fine
// but leak secrets or run as root.
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const dockerfile = read("Dockerfile");
const ignored = read(".dockerignore").split("\n").map((l) => l.trim());
const compose = read("../docker-compose.yml");

test(".env files are kept out of the build context", () => {
  expect(ignored).toEqual(expect.arrayContaining([".env", ".env.*", "node_modules"]));
});

test("the Dockerfile copies only what the server needs (no COPY . .)", () => {
  expect(dockerfile).not.toMatch(/^COPY\s+\.\s/m);
  expect(dockerfile).toMatch(/^RUN npm ci --omit=dev/m);
});

test("the server runs as the unprivileged node user", () => {
  expect(dockerfile).toMatch(/^USER node$/m);
});

test("the image health check calls GET /api/health", () => {
  expect(dockerfile).toMatch(/^HEALTHCHECK [\s\S]*\/api\/health/m);
});

test("docker-compose.yml contains no JWT secret, only a pass-through", () => {
  expect(compose).toMatch(/JWT_SECRET: \$\{JWT_SECRET:-\}/);
  expect(compose).not.toMatch(/JWT_SECRET: (?!\$\{)/);
});

test("the API waits for a healthy MongoDB", () => {
  expect(compose).toMatch(/depends_on:\s*\n\s*mongo:\s*\n\s*condition: service_healthy/);
});
