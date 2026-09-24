// Named import, not default: ioredis v6 is CommonJS, and under this repo's
// NodeNext module resolution a default import resolves to the module
// namespace object rather than the class, which isn't constructable.
import { Redis } from "ioredis";

/**
 * Redis is OPTIONAL everywhere it's used. With REDIS_URL unset the client is
 * never created and every cache call becomes a no-op that falls through to
 * the database — the service still works, just without the cache. That's
 * deliberate: a cache is an optimisation, and an optimisation that can take
 * the whole platform down when it fails is a worse trade than no cache.
 */
const redisUrl = process.env.REDIS_URL;

let client: Redis | null = null;

if (redisUrl) {
  client = new Redis(redisUrl, {
    // null, not a number: a queued command must never be auto-rejected.
    // rate-limit-redis loads a Lua script from its constructor at module load,
    // and if Redis happens to be down at that moment, a rejection there is an
    // unhandled promise rejection that kills the process on boot.
    //
    // Nothing hangs as a result, because neither caller ever issues a command
    // on a dead connection: the cache checks `status === "ready"` first, and
    // the rate limiter's sendCommand rejects immediately on a lost connection
    // (see Middleware/RateLimiter.ts). Both fall back to the database instead.
    maxRetriesPerRequest: null,
    // Back off, but never slower than 3s, so recovery is quick once Redis returns.
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 3000),
    // Must stay true (ioredis's default). Commands issued before the socket
    // finishes connecting — notably rate-limit-redis, which loads a Lua script
    // from its own constructor at module load — are queued until connect
    // instead of being rejected outright. Setting this false crashes every
    // service at startup. maxRetriesPerRequest above is what bounds the queue.
    enableOfflineQueue: true,
  });

  // ioredis emits 'error' as an EventEmitter error. With no listener attached,
  // Node treats it as an unhandled exception and kills the process — so a
  // Redis blip would crash the service. This listener is what keeps a cache
  // outage a degraded-but-alive condition.
  client.on("error", (error: Error) => {
    console.error("Redis error (continuing without cache):", error.message);
  });

  client.on("connect", () => console.log("Connected to Redis."));
}

export const redisClient = client;

export const isCacheEnabled = (): boolean => client !== null && client.status === "ready";

/** Only for tests and graceful shutdown — leaves the client unusable afterwards. */
export const disconnectRedis = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => undefined);
  }
};
