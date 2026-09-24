import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerJSDoc, { Options as SwaggerJSDocOptions } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";
import { buildAggregatedSpec } from "./aggregateSpecs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// swagger-jsdoc's glob matcher requires forward slashes — path.join
// on Windows returns backslashes, which silently match zero files.
const toGlob = (...segments: string[]) => path.join(...segments).split(path.sep).join("/");

/**
 * Walks up from this file to the folder holding all 5 sibling service
 * folders — a fixed hop count would be wrong depending on whether this
 * runs as source (tsx, from src/Swagger) or compiled output (node, from
 * dist/src/Swagger, one level deeper). Falls back to `startDir` (today's
 * behavior: aggregation silently finds nothing) if never found.
 */
const findBackendRoot = (startDir: string): string => {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "commerce-service")) && fs.existsSync(path.join(dir, "gateway-service"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
};

const backendRoot = findBackendRoot(__dirname);

// Written by `npm run generate:openapi` at Docker build time, when the
// build context is the whole monorepo — the one place sibling services'
// source is actually available (see gateway-service/Dockerfile and
// scripts/generate-openapi.mjs). Once packaged into the gateway's own
// container, sibling folders no longer exist on disk at runtime, so
// live aggregation would silently return an empty spec for them.
// Resolved against cwd (this service's own root, whether that's the repo
// checkout in dev or /app in the container) rather than __dirname, since
// __dirname's depth differs between source (src/Swagger) and compiled
// output (dist/src/Swagger).
const staticSpecPath = path.join(process.cwd(), "openapi.generated.json");

/**
 * The gateway's own spec (auth/audit/health/etc.) — built fresh every
 * time, live filesystem introspection over just this service's own
 * Controllers/Routes. Reused by both setupSwagger (live dev) and
 * scripts/generate-openapi.mjs (static build-time snapshot).
 */
export const buildGatewaySpec = () => {
  const swaggerDefinition = {
    openapi: "3.0.0",
    info: {
      title: "Laundry Platform API",
      description:
        "Single entry point for every client (web, admin, mPOS). Every route below is called exactly as shown — this gateway handles auth and routes internally to commerce/logistics/finance/growth; those services are not reachable directly.",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Obtain via POST /auth/login.",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 200 },
            result: { type: "object", nullable: true, description: "Endpoint-specific payload." },
            displayMessage: { type: "string", example: "Operation completed successfully." },
            status: { type: "boolean", example: true },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            statusCode: { type: "integer", example: 400 },
            result: { type: "object", nullable: true, example: null },
            displayMessage: { type: "string", example: "Something went wrong!" },
            status: { type: "boolean", example: false },
          },
        },
      },
    },
    // Swagger UI renders tag sections in the order declared here; anything
    // not listed falls in afterwards in discovery order. Without this, the
    // auth groups get scattered — "Auth" ends up several sections away from
    // "Auth - Login", which makes the one module a client integrates first
    // the hardest one to find.
    tags: [
      { name: "Auth", description: "Sign-in, token refresh, and account creation." },
      {
        name: "Auth - Registration",
        description: "Customer sign-up with phone verified by OTP. Not yet implemented.",
      },
      {
        name: "Auth - Login",
        description:
          "Customer sign-in by phone OTP or social provider. Email + password is under 'Auth'. Not yet implemented.",
      },
      {
        name: "Auth - Password Reset",
        description: "Forgotten-password recovery by email OTP. Not yet implemented.",
      },
      { name: "Security", description: "Audit log and backup status." },
      { name: "Access Control", description: "Access policy rules." },
      { name: "Notifications", description: "Outbound notification dispatch." },
    ],
    // Relative on purpose. A hardcoded "http://localhost:5000" breaks "Try it
    // out" whenever the docs are opened on any other host — 127.0.0.1, a LAN
    // IP, or a deployed domain — because the browser then makes a
    // cross-origin request that CORS rejects, surfacing only as
    // "Failed to fetch". Relative means requests always go back to whichever
    // host served the page, so it is same-origin everywhere.
    servers: [{ url: "/", description: "This server" }],
  };

  const options: SwaggerJSDocOptions = {
    swaggerDefinition,
    apis: [
      // Relative to this file: the source tree under tsx, the compiled tree
      // under node. Covers the normal local-dev case.
      toGlob(__dirname, "../Controllers/*.ts"),
      toGlob(__dirname, "../Controllers/*.js"),
      toGlob(__dirname, "../Routes/*.ts"),
      toGlob(__dirname, "../Routes/*.js"),
      // Also glob this service's own SOURCE via backendRoot, exactly as
      // aggregateSpecs.ts does for the other four.
      //
      // Needed because the build-time snapshot generator runs against dist/,
      // and tsc only preserves a JSDoc comment that is attached to emitted
      // code. A documentation-only file (UserAuth.Contract.ts — @openapi
      // blocks with no handlers under them) loses every block but the first
      // during compilation, so those endpoints silently vanished from the
      // generated spec while their tag headings still rendered. Reading the
      // .ts source keeps comment-only contract files intact.
      //
      // Matches nothing at container runtime, where no sibling source exists
      // — harmless, since that path serves the pre-generated snapshot anyway.
      toGlob(backendRoot, "gateway-service/src/Controllers/*.ts"),
      toGlob(backendRoot, "gateway-service/src/Routes/*.ts"),
    ],
  };

  return swaggerJSDoc(options);
};

/**
 * The ONLY Swagger UI in the whole system. Every service's routes are
 * documented here, exactly as an app/website team would actually call
 * them (through the gateway) — see aggregateSpecs.ts. commerce/
 * logistics/finance/growth run no docs UI of their own, and aren't
 * meant to be reachable directly at all (see INTERNAL_SERVICE_SECRET).
 */
const setupSwagger = (app: Express): void => {
  let swaggerSpec: any;

  if (fs.existsSync(staticSpecPath)) {
    // Running from the gateway's own container — sibling source isn't
    // on disk here, so serve the snapshot generated at Docker build time.
    swaggerSpec = JSON.parse(fs.readFileSync(staticSpecPath, "utf-8"));
  } else {
    // Local dev: sibling service folders are right there on disk, so
    // build it live — editing a route's JSDoc updates the docs on the
    // next request, no regeneration step needed.
    const gatewaySpec = buildGatewaySpec();
    swaggerSpec = buildAggregatedSpec(gatewaySpec, backendRoot);
  }

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: "Swagger - Laundry Platform API",
    })
  );
};

export default setupSwagger;
