const { Pool } = require("pg");
const { databaseUrl } = require("./config/env");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

module.exports = pool;
