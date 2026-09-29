// Redis is unavailable here (no REDIS_URL in the test env) — exactly the
// condition these tests exist for: the cache must be completely transparent.
import { getOrSet, cacheGet, cacheSet, cacheDel, TTL } from "./Cache.js";

describe("cache with Redis unavailable (graceful degradation)", () => {
  it("getOrSet still returns the loader's value", async () => {
    const loader = jest.fn().mockResolvedValue({ id: "1", name: "Wash & Fold" });
    const result = await getOrSet("service:1", TTL.LONG, loader);
    expect(result).toEqual({ id: "1", name: "Wash & Fold" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reports a miss rather than throwing", async () => {
    await expect(cacheGet("anything")).resolves.toBeNull();
  });

  it("swallows writes and deletes instead of failing the request", async () => {
    await expect(cacheSet("k", { a: 1 }, 60)).resolves.toBeUndefined();
    await expect(cacheDel("k")).resolves.toBeUndefined();
  });

  it("propagates a loader error unchanged — cache must not mask real failures", async () => {
    const loader = jest.fn().mockRejectedValue(new Error("database is down"));
    await expect(getOrSet("boom", TTL.SHORT, loader)).rejects.toThrow("database is down");
  });

  it("does not leave a failed load stuck in the in-flight map", async () => {
    const failing = jest.fn().mockRejectedValue(new Error("transient"));
    await expect(getOrSet("retry-me", TTL.SHORT, failing)).rejects.toThrow("transient");

    // If the rejected promise were left behind, this second call would return
    // the *old* rejection instead of retrying — a cached failure.
    const succeeding = jest.fn().mockResolvedValue("recovered");
    await expect(getOrSet("retry-me", TTL.SHORT, succeeding)).resolves.toBe("recovered");
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});

describe("stampede protection", () => {
  it("collapses concurrent loads of the same key into one call", async () => {
    // A slow loader, so all 5 callers are in flight simultaneously — that's
    // the condition single-flight exists for.
    const loader = jest.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("loaded-once"), 20))
    );

    const results = await Promise.all([
      getOrSet("hot-key", TTL.SHORT, loader),
      getOrSet("hot-key", TTL.SHORT, loader),
      getOrSet("hot-key", TTL.SHORT, loader),
      getOrSet("hot-key", TTL.SHORT, loader),
      getOrSet("hot-key", TTL.SHORT, loader),
    ]);

    // Without single-flight this would be 5 database queries.
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(5).fill("loaded-once"));
  });

  it("keeps different keys independent", async () => {
    const a = jest.fn().mockResolvedValue("A");
    const b = jest.fn().mockResolvedValue("B");
    const [ra, rb] = await Promise.all([
      getOrSet("key-a", TTL.SHORT, a),
      getOrSet("key-b", TTL.SHORT, b),
    ]);
    expect([ra, rb]).toEqual(["A", "B"]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
