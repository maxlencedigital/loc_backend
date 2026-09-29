import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildPoolConfig, DB_SCHEMA } from "./DatabaseUrl.js";

// One client for the whole process: PrismaClient owns a pool, so building it
// per request would exhaust the database's connection limit in seconds.
const adapter = new PrismaPg(buildPoolConfig(), { schema: DB_SCHEMA });

export const prisma = new PrismaClient({
  adapter,
  // Not "query": that level logs every statement with its parameters, writing
  // password and OTP hashes straight into the application log.
  log: ["warn", "error"],
});

const MAX_CONNECT_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries with backoff, since service and database cold-start together.
// Connectivity only: tables come from `npm run db:migrate`, never the server.
export const connectDB = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      await prisma.$connect();
      console.log(`Connected to PostgreSQL (schema: ${DB_SCHEMA}).`);
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

export const disconnectDB = async (): Promise<void> => {
  await prisma.$disconnect();
};
