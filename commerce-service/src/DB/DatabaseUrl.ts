import type { PoolConfig } from "pg";

// The connection the server uses for every query: DATABASE_URL (hosted) takes
// precedence over the discrete DB_* vars (local docker-compose).

const DEFAULT_POOL_MAX = 5;

const buildConnectionString = (): string => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;
  const missing = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) {
    throw new Error(`Set DATABASE_URL, or all of: ${missing.join(", ")}`);
  }
  // Passwords routinely contain URL-structural characters (@ : / ?). Unencoded,
  // a valid password silently yields a string pointing at the wrong host.
  const user = encodeURIComponent(DB_USER as string);
  const password = encodeURIComponent(DB_PASSWORD as string);
  return `postgresql://${user}:${password}@${DB_HOST}:${DB_PORT || 5432}/${DB_NAME}`;
};

// Each service gets its own Postgres schema inside one database — what keeps
// services out of each other's tables on a single free-tier Supabase instance.
export const DB_SCHEMA = process.env.DB_SCHEMA || "public";

export const buildPoolConfig = (): PoolConfig => {
  const connectionString = buildConnectionString();
  const { hostname } = new URL(connectionString);

  // Managed Postgres terminates TLS at a proxy whose chain Node has no root for.
  // rejectUnauthorized:false drops the chain check, never the encryption.
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "postgres";
  const useSsl = process.env.DB_SSL ? process.env.DB_SSL === "true" : !isLocal;

  return {
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // node-postgres defaults to 10 per pool; five services of that exceeds the
    // free plan, and the last to start fails with "too many connections".
    max: Number(process.env.DB_POOL_MAX) || DEFAULT_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
  };
};
