import { Options, Store, ClientRateLimitInfo, IncrementResponse } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../../commons/Cache/RedisClient.js";

/**
 * A rate-limit Store that only ever touches Redis when the connection is
 * actually `ready`, and builds the underlying RedisStore lazily the first
 * time that's true.
 *
 * Two problems this solves, both found by testing rather than theory:
 *
 * 1. Constructing RedisStore eagerly crashes the service at boot. Its
 *    constructor immediately issues a Lua SCRIPT LOAD; if that rejects (Redis
 *    not up yet) nothing catches it, and an unhandled rejection kills the
 *    process. Building it lazily means no command is ever issued before the
 *    connection exists.
 *
 * 2. Guarding on "is the connection lost" doesn't work. While Redis is down,
 *    ioredis cycles through `connecting` as it retries — so a status denylist
 *    ("end"/"close"/"reconnecting") lets commands slip through into the
 *    offline queue, where they block for the full request timeout. Measured at
 *    ~20s per request, on every route, i.e. a Redis outage becoming a total
 *    outage. Only `ready` means a command can actually be serviced, so that is
 *    the single condition allowed here.
 *
 * Every method throws when Redis isn't ready; express-rate-limit's
 * `passOnStoreError: true` turns that into "allow the request through",
 * instantly and with no added latency.
 */
export class RedisRateLimitStore implements Store {
  private delegate: RedisStore | null = null;
  private options: Options | null = null;

  constructor(private readonly keyPrefix: string) {}

  init(options: Options): void {
    // Remembered so it can be replayed into the real store whenever it's
    // finally built — express-rate-limit only calls init() once, at startup,
    // long before Redis may be reachable.
    this.options = options;
    this.delegate?.init(options);
  }

  private resolve(): RedisStore {
    const client = redisClient;
    if (!client || client.status !== "ready") {
      throw new Error("Redis unavailable — rate limiting bypassed for this request");
    }
    if (!this.delegate) {
      this.delegate = new RedisStore({
        prefix: this.keyPrefix,
        sendCommand: (...args: string[]) =>
          client.call(args[0], ...args.slice(1)) as Promise<any>,
      });
      if (this.options) this.delegate.init(this.options);
    }
    return this.delegate;
  }

  async increment(key: string): Promise<IncrementResponse> {
    return this.resolve().increment(key);
  }

  async decrement(key: string): Promise<void> {
    return this.resolve().decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    return this.resolve().resetKey(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.resolve().get(key);
  }
}
