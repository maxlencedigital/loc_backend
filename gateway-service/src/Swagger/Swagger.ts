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

// gateway-service/src/Swagger -> up 3 levels -> Backend/ (the folder
// that holds all 5 sibling service folders).
const backendRoot = path.join(__dirname, "../../..");

/**
 * The ONLY Swagger UI in the whole system. Every service's routes are
 * documented here, exactly as an app/website team would actually call
 * them (through the gateway) — see aggregateSpecs.ts. commerce/
 * logistics/finance/growth run no docs UI of their own, and aren't
 * meant to be reachable directly at all (see INTERNAL_SERVICE_SECRET).
 */
const setupSwagger = (app: Express): void => {
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
    servers: [
      { url: `http://localhost:${process.env.PORT || 5000}`, description: "Local development" },
    ],
  };

  const options: SwaggerJSDocOptions = {
    swaggerDefinition,
    apis: [
      toGlob(__dirname, "../Controllers/*.ts"),
      toGlob(__dirname, "../Controllers/*.js"),
      toGlob(__dirname, "../Routes/*.ts"),
      toGlob(__dirname, "../Routes/*.js"),
    ],
  };

  const gatewaySpec = swaggerJSDoc(options);
  const swaggerSpec = buildAggregatedSpec(gatewaySpec, backendRoot);

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
