import { Sequelize } from "sequelize";

const requiredVars = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"] as const;
const missing = requiredVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
}

// Off by default because local/dev MySQL (this repo's docker-compose.yml)
// has no TLS cert configured — turn this on with DB_SSL=true against any
// DB that does (every managed cloud MySQL does), so credentials and query
// data aren't sent in plaintext over the network in production.
const useDbSsl = process.env.DB_SSL === "true";

export const sequelize = new Sequelize(
  process.env.DB_NAME as string,
  process.env.DB_USER as string,
  process.env.DB_PASSWORD as string,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    dialect: "mysql",
    logging: false,
    define: {
      timestamps: true,
    },
    timezone: "+00:00",
    dialectOptions: useDbSsl ? { ssl: { rejectUnauthorized: true } } : {},
  }
);

const MAX_CONNECT_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries with backoff instead of failing on the first attempt — under an
 * orchestrator, this service and its DB container can cold-start together,
 * and a single-shot connect would crash-loop until the DB happens to win
 * the race.
 */
export const connectDB = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      await sequelize.authenticate();
      console.log("Connected to MySQL.");
      // Fine for a fresh, 2-table service. Once this schema is live with
      // real data, replace this with real migrations instead of auto-sync.
      await sequelize.sync({ alter: false });
      return;
    } catch (error) {
      if (attempt === MAX_CONNECT_ATTEMPTS) {
        throw error;
      }
      const backoffMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.error(
        `DB connection attempt ${attempt}/${MAX_CONNECT_ATTEMPTS} failed, retrying in ${backoffMs}ms...`
      );
      await delay(backoffMs);
    }
  }
};
