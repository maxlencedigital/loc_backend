import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Only meaningful when run with the whole monorepo checked out (Docker
// build time, or manually from a full local clone) — see
// gateway-service/Dockerfile and src/Swagger/Swagger.ts for why this
// snapshot exists at all. Requires `npm run build` to have already
// produced dist/, since it imports the compiled output.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { buildGatewaySpec } = await import("../dist/src/Swagger/Swagger.js");
const { buildAggregatedSpec } = await import("../dist/src/Swagger/aggregateSpecs.js");

// gateway-service/scripts -> up 2 -> Backend/ (the folder holding all
// 5 sibling service folders).
const backendRoot = path.join(__dirname, "../..");

const gatewaySpec = buildGatewaySpec();
const fullSpec = buildAggregatedSpec(gatewaySpec, backendRoot);

const outPath = path.join(__dirname, "../openapi.generated.json");
fs.writeFileSync(outPath, JSON.stringify(fullSpec, null, 2));
console.log(`Generated aggregated OpenAPI spec -> ${outPath}`);
