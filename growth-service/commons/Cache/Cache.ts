import { redisClient, isCacheEnabled } from "./RedisClient.js";

// Prefixes every key so all 5 services can share one Redis without colliding,
// and so a service can invalidate only its own keys.
const KEY_NAMESPACE = process.env.CACHE_NAMESPACE || "app";

const namespaced = (key: string) => `${KEY_NAMESPACE}:${key}`;

// In-flight loaders, keyed by cache key. Without this, every concurrent request
// for an expiring hot key hits the database at once — a cache stampede.
const inFlight = new Map<string, Promise<unknown>>();

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!isCacheEnabled() || !redisClient) return null;
  try {
    const raw = await redisClient.get(namespaced(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    // A cache read failure must never fail the request: report a miss and let
    // the caller go to the database.
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

// Invalidates everything under a prefix. SCAN not KEYS, UNLINK not DEL: both of
// the alternatives block the whole Redis server on a large keyspace.
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

// Returns the cached value, or runs `loader` and caches it. `loader` is always
// the source of truth, so a dead or disabled Redis only costs latency.
export const getOrSet = async <T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> => {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  // Someone else is already loading this key — wait for their result rather
  // than issuing a duplicate query.
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    try {
      const fresh = await loader();
      // Never cache null/undefined: indistinguishable from "not cached" on read.
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

// Short by default — a stale price is worse than a slow one.
export const TTL = {
  /** Reference data that changes rarely: catalog, services, garment types. */
  LONG: 60 * 60,
  /** Entity reads that change occasionally: a store, a customer profile. */
  MEDIUM: 5 * 60,
  /** Lists and search results, stale as soon as anything is written. */
  SHORT: 30,
} as const;
