import "./commons/Config/LoadEnv";
import { defineConfig } from "prisma/config";
import { buildCliUrls } from "./scripts/database-url.mjs";

// Prisma CLI config: v7 takes no connection URL in schema.prisma, and the CLI
// has no DB_SCHEMA setting, so the URL comes from scripts/database-url.mjs.

// Lenient on purpose: `prisma generate` needs no database and runs during
// `npm run build`, where Docker and Render have no credentials.
const resolveUrl = (): string | undefined => {
  try {
    return buildCliUrls().url;
  } catch (error) {
    console.warn(
      `[prisma.config] No database URL resolved (${
        error instanceof Error ? error.message : error
      }). Fine for \`generate\`; \`migrate\` needs DATABASE_URL or the DB_* vars.`
    );
    return undefined;
  }
};

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveUrl(),
  },
});
