import { Options, Store, ClientRateLimitInfo, IncrementResponse } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../../commons/Cache/RedisClient.js";

// A rate-limit Store that touches Redis only when the connection is `ready`.
// Methods throw otherwise, which `passOnStoreError` allows straight through.
export class RedisRateLimitStore implements Store {
  private delegate: RedisStore | null = null;
  private options: Options | null = null;

  constructor(private readonly keyPrefix: string) {}

  init(options: Options): void {
    // Remembered so it can be replayed into the real store once it is built:
    // express-rate-limit calls init() once at startup, long before Redis is up.
    this.options = options;
    this.delegate?.init(options);
  }

  private resolve(): RedisStore {
    const client = redisClient;
    // Strictly `ready`: ioredis passes through `connecting` while retrying, and
    // commands sent then block in the offline queue for the whole timeout.
    if (!client || client.status !== "ready") {
      throw new Error("Redis unavailable — rate limiting bypassed for this request");
    }
    // Lazy: RedisStore's constructor issues a Lua SCRIPT LOAD immediately, and
    // an unhandled rejection there kills the process at boot.
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
