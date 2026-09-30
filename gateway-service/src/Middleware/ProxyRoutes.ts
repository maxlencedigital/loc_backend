import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { Request } from "express";
import { AuthenticatedRequest } from "./Auth.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only these roles may act on a store other than their own.
const STORE_SWITCHING_ROLES = ["super_admin", "admin"];

// Forwards the identity verifyToken established, plus the internal secret only
// the gateway holds — the proof a request did not arrive with forged headers.
const forwardIdentity = (proxyReq: any, req: Request) => {
  // Never trust identity headers a client sent itself: on a route without a JWT
  // nothing would overwrite them, and downstream would read them as verified.
  proxyReq.removeHeader("x-user-id");
  proxyReq.removeHeader("x-user-role");
  proxyReq.removeHeader("x-user-store-id");
  proxyReq.removeHeader("x-user-name");
  proxyReq.removeHeader("x-store-scope");
  // Consumed below as a request, never forwarded: downstream reads only x-store-scope.
  proxyReq.removeHeader("x-store-id");

  const authReq = req as AuthenticatedRequest;
  if (authReq.user) {
    proxyReq.setHeader("x-user-id", authReq.user.id);
    proxyReq.setHeader("x-user-role", authReq.user.role);
    // Percent-encoded: header values must be ASCII and names are not.
    if (authReq.user.name) proxyReq.setHeader("x-user-name", encodeURIComponent(authReq.user.name));
    if (authReq.user.storeId) {
      proxyReq.setHeader("x-user-store-id", authReq.user.storeId);
    }
    // The dashboard sends "all" for every store; that and any other non-UUID is no scope.
    const requestedStore = req.header("x-store-id");
    if (
      requestedStore &&
      STORE_SWITCHING_ROLES.includes(authReq.user.role) &&
      UUID_PATTERN.test(requestedStore)
    ) {
      proxyReq.setHeader("x-store-scope", requestedStore);
    }
  }
  proxyReq.setHeader("x-internal-secret", process.env.INTERNAL_SERVICE_SECRET || "");

  // express.json() has already consumed the request stream, so the upstream would
  // wait forever for a body that never arrives. Re-write the parsed body into the
  // proxied request. A no-op when the body was not parsed (raw/multipart streams).
  fixRequestBody(proxyReq, req);
};

// mountPath must be stripped explicitly: in http-proxy-middleware v2, relying
// on Express to have done it forwards "/commerce/health" instead of "/health".
const buildServiceProxy = (target: string, mountPath: string) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { [`^${mountPath}`]: "" },
    onProxyReq: forwardIdentity,
  } as any);

export { buildServiceProxy };
