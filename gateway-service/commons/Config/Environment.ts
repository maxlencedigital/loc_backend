// One switch for the whole environment: IS_LOCAL=true on a laptop, absent or
// false on a host. Everything else follows from it, so no .env is edited when
// moving between the two.

type Env = Record<string, string | undefined>;

export type EnvironmentMode = "local" | "hosted";

// Hosted connection strings. Local mode never reads them, so a Supabase URL left
// in a .env cannot make a laptop write to the hosted database.
const HOSTED_ONLY_VARS = ["DATABASE_URL", "DIRECT_DATABASE_URL"];

// Applied only when the variable is unset; anything in .env wins.
const LOCAL_DEFAULTS: Record<string, string> = {
  NODE_ENV: "development",
  ENABLE_DOCS: "true",
  RATE_LIMIT_ENABLED: "false",
  CORS_ORIGIN: "*",
  GATEWAY_SERVICE_URL: "http://127.0.0.1:5000",
  COMMERCE_SERVICE_URL: "http://127.0.0.1:5001",
  LOGISTICS_SERVICE_URL: "http://127.0.0.1:5002",
  FINANCE_SERVICE_URL: "http://127.0.0.1:5003",
  GROWTH_SERVICE_URL: "http://127.0.0.1:5004",
};

const LOCAL_PREFIX = "LOCAL_";

export const applyEnvironment = (env: Env): EnvironmentMode => {
  if (env.IS_LOCAL !== "true") return "hosted";

  // Render sets RENDER on every service. IS_LOCAL=true there would switch off
  // rate limiting and open CORS on the public internet.
  if (env.RENDER) {
    throw new Error("IS_LOCAL=true on a Render service. Set it to false (or remove it).");
  }

  for (const key of HOSTED_ONLY_VARS) delete env[key];

  // LOCAL_<NAME> replaces <NAME> in local mode, e.g. LOCAL_EMAIL_FROM.
  for (const key of Object.keys(env)) {
    if (!key.startsWith(LOCAL_PREFIX) || env[key] === undefined) continue;
    env[key.slice(LOCAL_PREFIX.length)] = env[key];
  }

  for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) {
    if (!env[key]) env[key] = value;
  }
  return "local";
};
