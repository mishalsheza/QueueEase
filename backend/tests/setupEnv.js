// Runs before each test file. Tests never read backend/.env, so they cannot
// touch a real database.
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV = "test";
