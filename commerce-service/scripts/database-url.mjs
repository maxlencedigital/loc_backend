// For the Prisma CLI only; the server builds its own in src/DB/DatabaseUrl.ts.
// Both stitch on DB_SCHEMA, which Prisma takes only as a URL parameter.

/** Reads the discrete DB_* vars used by local docker-compose. */
const buildFromParts = () => {
  const { DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;
  const missing = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Set DATABASE_URL, or all of: ${missing.join(", ")}`);
  }
  // Passwords routinely contain URL-structural characters (@ : / ?). Unencoded,
  // a valid password silently yields a string pointing at the wrong host.
  return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT || 5432}/${DB_NAME}`;
};

export const buildCliUrls = () => {
  const schema = process.env.DB_SCHEMA || "public";

  // Migrations use a DIRECT connection, never the pooler: Prisma Migrate takes
  // an advisory lock, and transaction-mode pooling would release it on a
  // different connection than took it. Its own variable because Supabase serves
  // the direct connection from a different host and port.
  const url = new URL(
    process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || buildFromParts()
  );
  url.searchParams.set("schema", schema);

  return { url: url.toString(), schema };
};
