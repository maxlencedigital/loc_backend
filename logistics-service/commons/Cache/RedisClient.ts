// Named import, not default: ioredis v6 is CommonJS, and under NodeNext a
// default import resolves to the namespace object, which isn't constructable.
import { Redis } from "ioredis";

// Redis is OPTIONAL. With REDIS_URL unset, every cache call becomes a no-op
// that falls through to the database rather than taking the service down.
const redisUrl = process.env.REDIS_URL;

let client: Redis | null = null;

if (redisUrl) {
  client = new Redis(redisUrl, {
    // null, not a number: rate-limit-redis loads a Lua script from its
    // constructor, and a rejection there kills the process on boot.
    maxRetriesPerRequest: null,
    // Back off, but never slower than 3s, so recovery is quick.
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 3000),
    // Must stay true. Setting it false rejects that same startup Lua script
    // outright and crashes every service; maxRetriesPerRequest bounds the queue.
    enableOfflineQueue: true,
  });

  // Without an 'error' listener Node treats ioredis's error event as an
  // unhandled exception and kills the process on any Redis blip.
  client.on("error", (error: Error) => {
    console.error("Redis error (continuing without cache):", error.message);
  });

  client.on("connect", () => console.log("Connected to Redis."));
}

export const redisClient = client;

export const isCacheEnabled = (): boolean => client !== null && client.status === "ready";

/** Only for tests and graceful shutdown — leaves the client unusable after. */
export const disconnectRedis = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => undefined);
  }
};
