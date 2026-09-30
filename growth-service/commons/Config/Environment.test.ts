import { applyEnvironment } from "./Environment.js";

describe("applyEnvironment", () => {
  it("changes nothing when IS_LOCAL is absent or not exactly true", () => {
    for (const flag of [undefined, "false", "", "1", "TRUE"]) {
      const env = { IS_LOCAL: flag, DATABASE_URL: "postgres://h/db", LOCAL_EMAIL_FROM: "x" };
      const before = { ...env };

      expect(applyEnvironment(env)).toBe("hosted");
      expect(env).toEqual(before);
    }
  });

  it("drops the hosted database URLs so a laptop falls back to the DB_* vars", () => {
    const env: Record<string, string | undefined> = {
      IS_LOCAL: "true",
      DATABASE_URL: "postgres://supabase/db",
      DIRECT_DATABASE_URL: "postgres://supabase-direct/db",
      DB_HOST: "127.0.0.1",
    };

    expect(applyEnvironment(env)).toBe("local");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DIRECT_DATABASE_URL).toBeUndefined();
    expect(env.DB_HOST).toBe("127.0.0.1");
  });

  it("lets LOCAL_<NAME> replace <NAME>, including a local database URL", () => {
    const env: Record<string, string | undefined> = {
      IS_LOCAL: "true",
      DATABASE_URL: "postgres://supabase/db",
      LOCAL_DATABASE_URL: "postgres://127.0.0.1/dev",
      EMAIL_FROM: "hosted@loc.test",
      LOCAL_EMAIL_FROM: "dev@loc.test",
    };

    applyEnvironment(env);

    expect(env.DATABASE_URL).toBe("postgres://127.0.0.1/dev");
    expect(env.EMAIL_FROM).toBe("dev@loc.test");
  });

  it("fills local defaults but never overrides a value already set", () => {
    const env: Record<string, string | undefined> = {
      IS_LOCAL: "true",
      RATE_LIMIT_ENABLED: "true",
      CORS_ORIGIN: "http://localhost:3000",
    };

    applyEnvironment(env);

    expect(env.RATE_LIMIT_ENABLED).toBe("true");
    expect(env.CORS_ORIGIN).toBe("http://localhost:3000");
    expect(env.NODE_ENV).toBe("development");
    expect(env.ENABLE_DOCS).toBe("true");
    expect(env.COMMERCE_SERVICE_URL).toBe("http://127.0.0.1:5001");
  });

  it("refuses to run as local on a Render service", () => {
    expect(() => applyEnvironment({ IS_LOCAL: "true", RENDER: "true" })).toThrow(/Render/);
  });
});
