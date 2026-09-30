import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import swaggerJSDoc, { Options as SwaggerJSDocOptions } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";
import { buildAggregatedSpec } from "./aggregateSpecs.js";
import { API_TAGS } from "./Tags.generated.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// swagger-jsdoc's glob matcher requires forward slashes — path.join
// on Windows returns backslashes, which silently match zero files.
const toGlob = (...segments: string[]) => path.join(...segments).split(path.sep).join("/");

// Walks up to the folder holding all 5 service folders. A fixed hop count
// would be wrong, since dist/ output sits one level deeper than source.
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

// Written by `npm run generate:openapi` at Docker build time, the one point
// where sibling source exists. Against cwd, since __dirname's depth varies.
const staticSpecPath = path.join(process.cwd(), "openapi.generated.json");

// The gateway's own spec, built fresh from its own Controllers/Routes. Used by
// setupSwagger (live dev) and generate-openapi.mjs (build-time snapshot).
export const buildGatewaySpec = () => {
  const swaggerDefinition = {
    openapi: "3.0.0",
    info: {
      title: "Laundry Platform API",
      description:
        "Single entry point for every client. Every route below is called exactly as shown — the gateway handles auth and routes internally; the services behind it are not reachable directly.\n\n" +
        "**Sections follow the people who use the platform:** Customer, Rider, Store (staff), Dispatch, Admin, then HR & Operations (with Employee Self-Service for staff and riders). " +
        "Each operation lists who may call it (also machine-readable as `x-roles`); super_admin may call everything.\n\n" +
        "**Responses** always use one envelope: { statusCode, result, displayMessage, status }. **Errors** use the same envelope with status false.\n\n" +
        "**Scaffolds:** endpoints that answer 501 are agreed contracts with the implementation still to come — build against the documented request and response shapes.\n\n" +
        "**No token needed** only for the few endpoints under /<service>/public/ and the sign-in and registration routes.",
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
    // Section order is the order of the journey: customer, rider, store, dispatch, admin, HR.
    tags: API_TAGS,
    // Relative on purpose: a hardcoded host breaks "Try it out" from any other
    // address with an opaque "Failed to fetch". Relative is always same-origin.
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
      // Also the .ts SOURCE: tsc only keeps JSDoc attached to emitted code, so a
      // comment-only contract file loses every block but the first in dist/.
      toGlob(backendRoot, "gateway-service/src/Controllers/*.ts"),
      toGlob(backendRoot, "gateway-service/src/Routes/*.ts"),
    ],
  };

  return swaggerJSDoc(options);
};

// The ONLY Swagger UI in the system: every service's routes documented exactly
// as a client calls them, through the gateway. The other four run no UI.
const setupSwagger = (app: Express): void => {
  let swaggerSpec: any;

  if (fs.existsSync(staticSpecPath)) {
    // Running from the gateway's own container — sibling source isn't
    // on disk here, so serve the snapshot generated at Docker build time.
    swaggerSpec = JSON.parse(fs.readFileSync(staticSpecPath, "utf-8"));
  } else {
    // Local dev: sibling folders are on disk, so build live — editing a route's
    // JSDoc updates the docs on the next request, with no regeneration step.
    const gatewaySpec = buildGatewaySpec();
    swaggerSpec = buildAggregatedSpec(gatewaySpec, backendRoot);
  }

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customSiteTitle: "Swagger - Laundry Platform API",
      swaggerOptions: {
        docExpansion: "none", // sections collapsed: there are hundreds of endpoints
        filter: true, //           a search box over sections and paths
        persistAuthorization: true, // keep the pasted token across reloads
        tagsSorter: undefined, //  keep the journey order declared in the spec
        defaultModelsExpandDepth: -1,
      },
    })
  );
};

export default setupSwagger;
