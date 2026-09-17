import { createProxyMiddleware } from "http-proxy-middleware";
import { Request } from "express";
import { AuthenticatedRequest } from "./Auth.js";

/**
 * Attaches the identity verifyToken already established to the
 * outgoing request, so commerce/logistics/finance/growth can read
 * x-user-id / x-user-role directly instead of decoding a JWT again.
 * Also attaches the shared internal secret — without it, those
 * services refuse the request outright, even with the identity
 * headers present. Only the gateway holds this secret, so it's the
 * proof a request genuinely came through here and wasn't sent
 * directly to the service's port with hand-forged identity headers.
 */
const forwardIdentity = (proxyReq: any, req: Request) => {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user) {
    proxyReq.setHeader("x-user-id", authReq.user.id);
    proxyReq.setHeader("x-user-role", authReq.user.role);
  }
  proxyReq.setHeader("x-internal-secret", process.env.INTERNAL_SERVICE_SECRET || "");
};

/**
 * `mountPath` (e.g. "/commerce") must be stripped explicitly via
 * pathRewrite — relying on Express having already stripped it from
 * req.url before handing off to http-proxy-middleware does not work
 * reliably in v2, and forwards "/commerce/health" instead of "/health".
 */
const buildServiceProxy = (target: string, mountPath: string) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { [`^${mountPath}`]: "" },
    onProxyReq: forwardIdentity,
  } as any);

export { buildServiceProxy };
