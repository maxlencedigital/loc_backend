import { createProxyMiddleware } from "http-proxy-middleware";
import { Request } from "express";
import { AuthenticatedRequest } from "./Auth.js";

// Forwards the identity verifyToken established, plus the internal secret only
// the gateway holds — the proof a request did not arrive with forged headers.
const forwardIdentity = (proxyReq: any, req: Request) => {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user) {
    proxyReq.setHeader("x-user-id", authReq.user.id);
    proxyReq.setHeader("x-user-role", authReq.user.role);
  }
  proxyReq.setHeader("x-internal-secret", process.env.INTERNAL_SERVICE_SECRET || "");
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
