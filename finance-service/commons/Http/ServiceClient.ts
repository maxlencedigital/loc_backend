import { CustomException } from "../Exception/CustomException.js";
import { badRequest, serviceUnavailable } from "../Utils/StatusCode.js";

// How one service calls another: plain HTTPS with the internal secret, never through the
// gateway and never straight to another service's tables. Calls go to `/internal/*`
// routes (service identity, no user) or to the normal routes on behalf of a user (pass
// `as`, and the target applies its usual role and store rules to that user).
//
// Built for a free tier that sleeps and drops connections: a short timeout, bounded
// retries for reads only, and a per-target circuit breaker so a dead service costs one
// fast failure instead of a queue of slow ones.

export type ServiceName = "gateway" | "commerce" | "logistics" | "finance" | "growth";

export interface OnBehalfOf {
  userId: string;
  role: string;
  storeId?: string | null;
  scopeStoreId?: string | null;
  name?: string | null;
}

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Run as this user. Omit for a system call to an /internal route. */
  as?: OnBehalfOf;
  timeoutMs?: number;
  /** Only reads retry by default; set true for a write that is safe to repeat. */
  idempotent?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 600];
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 10_000;

const breaker = new Map<ServiceName, { failures: number; openUntil: number }>();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseUrl = (target: ServiceName): string => {
  const url = process.env[`${target.toUpperCase()}_SERVICE_URL`];
  if (!url) {
    throw new CustomException(`${target} service is not configured.`, serviceUnavailable);
  }
  return url.replace(/\/+$/, "");
};

const unavailable = (target: ServiceName) =>
  new CustomException("A connected service is unavailable right now. Please try again.", serviceUnavailable, {
    service: target,
  });

const recordFailure = (target: ServiceName) => {
  const state = breaker.get(target) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) state.openUntil = Date.now() + BREAKER_OPEN_MS;
  breaker.set(target, state);
};
const recordSuccess = (target: ServiceName) => breaker.delete(target);

const buildHeaders = (options: CallOptions): Record<string, string> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-service-name": process.env.DB_SCHEMA ?? "unknown",
  };
  const as = options.as;
  if (as) {
    headers["x-user-id"] = as.userId;
    headers["x-user-role"] = as.role;
    if (as.storeId) headers["x-user-store-id"] = as.storeId;
    if (as.scopeStoreId) headers["x-store-scope"] = as.scopeStoreId;
    if (as.name) headers["x-user-name"] = encodeURIComponent(as.name);
  }
  return headers;
};

const buildUrl = (target: ServiceName, path: string, query: CallOptions["query"]): string => {
  const url = new URL(`${baseUrl(target)}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
};

interface Envelope<T> {
  status?: boolean;
  statusCode?: number;
  result?: T;
  displayMessage?: string;
}

/** Calls another service and returns the envelope's `result`. */
const call = async <T = unknown>(
  target: ServiceName,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: CallOptions = {}
): Promise<T> => {
  const state = breaker.get(target);
  if (state && state.openUntil > Date.now()) throw unavailable(target);

  const url = buildUrl(target, path, options.query);
  const retries = method === "GET" || options.idempotent ? MAX_RETRIES : 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1] ?? 600);
    try {
      const response = await fetch(url, {
        method,
        headers: buildHeaders(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const text = await response.text();
      let envelope: Envelope<T> | null = null;
      try {
        envelope = text ? (JSON.parse(text) as Envelope<T>) : null;
      } catch {
        envelope = null;
      }

      if (response.status >= 500) {
        lastError = new Error(`${target} answered HTTP ${response.status}`);
        recordFailure(target);
        continue;
      }
      recordSuccess(target);
      if (!response.ok || envelope?.status === false) {
        // The other service refused on its merits (validation, not found, forbidden):
        // pass that answer through unchanged, never retry it.
        throw new CustomException(
          envelope?.displayMessage || "The request was refused.",
          response.status >= 400 && response.status < 500 ? response.status : badRequest,
          envelope?.result ?? undefined
        );
      }
      return (envelope?.result ?? null) as T;
    } catch (error) {
      if (error instanceof CustomException) throw error;
      lastError = error;
      recordFailure(target);
    }
  }

  console.error(`[service-client] ${method} ${target}${path} failed:`, (lastError as Error)?.message);
  throw unavailable(target);
};

/** Test hook: forget breaker state between tests. */
const reset = () => breaker.clear();

export const ServiceClient = {
  call,
  get: <T = unknown>(target: ServiceName, path: string, options?: CallOptions) => call<T>(target, "GET", path, options),
  post: <T = unknown>(target: ServiceName, path: string, options?: CallOptions) => call<T>(target, "POST", path, options),
  patch: <T = unknown>(target: ServiceName, path: string, options?: CallOptions) => call<T>(target, "PATCH", path, options),
  put: <T = unknown>(target: ServiceName, path: string, options?: CallOptions) => call<T>(target, "PUT", path, options),
  del: <T = unknown>(target: ServiceName, path: string, options?: CallOptions) => call<T>(target, "DELETE", path, options),
  reset,
};
