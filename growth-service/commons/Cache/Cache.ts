import { redisClient, isCacheEnabled } from "./RedisClient.js";

/**
 * Prefixed onto every key so all 5 services can share one Redis without
 * colliding, and so a service can invalidate only its own keys.
 * Set per service, e.g. "gateway", "commerce".
 */
const KEY_NAMESPACE = process.env.CACHE_NAMESPACE || "app";

const namespaced = (key: string) => `${KEY_NAMESPACE}:${key}`;

/**
 * In-flight loaders, keyed by cache key. Without this, the moment a hot key
 * expires every concurrent request for it misses at once and they all hit the
 * database together — a cache stampede, which reliably turns a cache expiry
 * into an outage under load. Sharing one in-flight promise collapses those
 * N queries into 1. This is per-process, so N instances still produce at most
 * N queries rather than N x concurrent-requests.
 */
const inFlight = new Map<string, Promise<unknown>>();

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!isCacheEnabled() || !redisClient) return null;
  try {
    const raw = await redisClient.get(namespaced(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    // A cache read failure must never fail the request — report a miss and
    // let the caller go to the database.
    console.error(`Cache read failed for "${key}":`, (error as Error).message);
    return null;
  }
};

export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!isCacheEnabled() || !redisClient) return;
  try {
    await redisClient.set(namespaced(key), JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    console.error(`Cache write failed for "${key}":`, (error as Error).message);
  }
};

export const cacheDel = async (...keys: string[]): Promise<void> => {
  if (!isCacheEnabled() || !redisClient || keys.length === 0) return;
  try {
    await redisClient.unlink(...keys.map(namespaced));
  } catch (error) {
    console.error(`Cache delete failed for "${keys.join(", ")}":`, (error as Error).message);
  }
};

/**
 * Invalidate everything under a prefix, e.g. after a write that affects an
 * unknown number of cached list queries ("commerce:services:*").
 *
 * Uses SCAN, never KEYS. KEYS walks the entire keyspace in one blocking call
 * — on a large cache that stalls every other Redis client for the duration,
 * which is exactly the kind of self-inflicted outage a cache is supposed to
 * prevent. UNLINK over DEL for the same reason: it frees memory on a
 * background thread instead of blocking on large values.
 */
export const cacheDelByPrefix = async (prefix: string): Promise<void> => {
  if (!isCacheEnabled() || !redisClient) return;
  try {
    const match = `${namespaced(prefix)}*`;
    let cursor = "0";
    do {
      const [next, found] = await redisClient.scan(cursor, "MATCH", match, "COUNT", 200);
      cursor = next;
      if (found.length > 0) {
        await redisClient.unlink(...found);
      }
    } while (cursor !== "0");
  } catch (error) {
    console.error(`Cache prefix delete failed for "${prefix}":`, (error as Error).message);
  }
};

/**
 * The main entry point: return the cached value, or run `loader`, cache its
 * result and return it.
 *
 * `loader` is always the source of truth — if Redis is down, unreachable, or
 * simply disabled, this degrades to calling `loader` directly every time.
 * Callers cannot tell the difference apart from latency, which is the point.
 */
export const getOrSet = async <T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> => {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  // Someone else is already loading this exact key — wait for their result
  // instead of issuing a duplicate query.
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const fresh = await loader();
      // Don't cache null/undefined: it's ambiguous with "not cached" on read,
      // and caching "not found" needs a deliberate sentinel, not an accident.
      if (fresh !== null && fresh !== undefined) {
        await cacheSet(key, fresh, ttlSeconds);
      }
      return fresh;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
};

/** Standard TTLs. Short by default — a stale price is worse than a slow one. */
export const TTL = {
  /** Reference data that changes rarely: catalog, services, garment types. */
  LONG: 60 * 60,
  /** Entity reads that change occasionally: a store, a customer profile. */
  MEDIUM: 5 * 60,
  /** Lists and search results, which go stale as soon as anything is written. */
  SHORT: 30,
} as const;
