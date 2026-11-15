// Runs before each test file. Tests never read backend/.env, so they cannot
// touch a real database.
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "http://localhost:8081";
// High enough that ordinary tests never hit the auth rate limit;
// tests/security.test.js builds its own app with a low limit.
process.env.AUTH_RATE_LIMIT_MAX = "100000";
