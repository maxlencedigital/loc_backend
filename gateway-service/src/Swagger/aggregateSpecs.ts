import path from "path";
import swaggerJSDoc from "swagger-jsdoc";

// swagger-jsdoc's glob matcher requires forward slashes — path.join on
// Windows returns backslashes, which silently match zero files.
const toGlob = (...segments: string[]) => path.join(...segments).split(path.sep).join("/");

interface DownstreamServiceConfig {
  key: string;
  name: string;
  mountPath: string; // how a client reaches it through the gateway, e.g. "/commerce"
  sourceDir: string; // absolute path to that service's own folder
}

/**
 * These 4 services are siblings of gateway-service under Backend/.
 * Their route JSDoc comments are parsed straight off disk — they run
 * no Swagger UI of their own, so this is the only place their API
 * surface gets documented.
 */
const buildDownstreamConfigs = (backendRoot: string): DownstreamServiceConfig[] => [
  {
    key: "commerce",
    name: "Commerce",
    mountPath: "/commerce",
    sourceDir: path.join(backendRoot, "commerce-service"),
  },
  {
    key: "logistics",
    name: "Logistics",
    mountPath: "/logistics",
    sourceDir: path.join(backendRoot, "logistics-service"),
  },
  {
    key: "finance",
    name: "Finance",
    mountPath: "/finance",
    sourceDir: path.join(backendRoot, "finance-service"),
  },
  {
    key: "growth",
    name: "Growth",
    mountPath: "/growth",
    sourceDir: path.join(backendRoot, "growth-service"),
  },
];

const SUCCESS_CODES = new Set(["200", "201", "202", "204"]);

/**
 * Every documented operation gets the same envelope shown for its
 * responses — matching commons/Response/Response.ts exactly — so app
 * and website teams see one consistent contract everywhere, not a
 * different ad-hoc shape per endpoint.
 */
const applyStandardEnvelope = (paths: Record<string, any>) => {
  for (const pathKey of Object.keys(paths)) {
    for (const method of Object.keys(paths[pathKey])) {
      const operation = paths[pathKey][method];
      if (!operation || typeof operation !== "object") continue;
      operation.responses = operation.responses || {};
      for (const statusCode of Object.keys(operation.responses)) {
        const response = operation.responses[statusCode];
        if (response.content) continue; // already fully specified, leave it alone
        const schemaRef = SUCCESS_CODES.has(statusCode)
          ? "#/components/schemas/SuccessResponse"
          : "#/components/schemas/ErrorResponse";
        response.content = {
          "application/json": { schema: { $ref: schemaRef } },
        };
      }
      // Every authenticated route can fail these two ways even if the
      // handler's own JSDoc didn't think to list them — document them
      // once, here, instead of repeating it in every controller.
      if (operation.security && !operation.responses["401"]) {
        operation.responses["401"] = {
          description: "Missing or invalid Bearer token.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        };
      }
      if (!operation.responses["500"]) {
        operation.responses["500"] = {
          description: "Unexpected server error.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        };
      }
    }
  }
};

/**
 * Builds ONE OpenAPI document covering every service — the gateway's
 * own auth/audit/health routes plus commerce/logistics/finance/growth,
 * with paths rewritten exactly as a client calls them (through the
 * gateway, e.g. "/commerce/health", never the service's own root).
 * This is deliberately the only Swagger UI in the whole system: app
 * and website teams integrate against one contract, not five.
 */
export const buildAggregatedSpec = (gatewaySpec: any, backendRoot: string) => {
  const combinedPaths: Record<string, any> = { ...gatewaySpec.paths };

  for (const svc of buildDownstreamConfigs(backendRoot)) {
    const svcSpec = swaggerJSDoc({
      swaggerDefinition: { openapi: "3.0.0", info: { title: svc.name, version: "1.0.0" } },
      apis: [
        toGlob(svc.sourceDir, "src/Controllers/*.ts"),
        toGlob(svc.sourceDir, "src/Routes/*.ts"),
      ],
    }) as any;

    for (const [routePath, methods] of Object.entries(svcSpec.paths || {})) {
      const rewrittenPath = `${svc.mountPath}${routePath}`;
      const rewrittenMethods: Record<string, any> = {};
      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        rewrittenMethods[method] = {
          ...operation,
          tags: operation.tags && operation.tags.length ? operation.tags : [svc.name],
          // Every downstream route is reached through the gateway and
          // therefore always requires the same Bearer token as /auth/login issues.
          security: operation.security ?? [{ BearerAuth: [] }],
        };
      }
      combinedPaths[rewrittenPath] = rewrittenMethods;
    }
  }

  applyStandardEnvelope(combinedPaths);

  return {
    ...gatewaySpec,
    paths: combinedPaths,
  };
};
