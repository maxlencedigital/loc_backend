import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./src/DB/Prisma.Connection.Db.js";
import router from "./src/Routes/Logistics.Routes.js";
import { requireInternalSecret } from "./src/Middleware/Identity.js";
import { apiLimiter } from "./src/Middleware/RateLimiter.js";

// DATABASE_URL carries host, user, password and database in one string, so
// the discrete DB_* vars are for local docker-compose only.
const requiredEnvVars = [
  ...(process.env.DATABASE_URL ? [] : ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"]),
  "INTERNAL_SERVICE_SECRET",
  "CORS_ORIGIN",
];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

// A guessable INTERNAL_SERVICE_SECRET lets anyone skip the gateway and forge
// x-user-id/x-user-role — fail at boot rather than accept it silently.
const MIN_SECRET_LENGTH = 32;
if ((process.env.INTERNAL_SERVICE_SECRET as string).length < MIN_SECRET_LENGTH) {
  console.error(`INTERNAL_SERVICE_SECRET must be at least ${MIN_SECRET_LENGTH} random characters.`);
  process.exit(1);
}

const app = express();

// Only set when actually behind a real reverse proxy/load balancer.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY));
}

app.use(cors({ origin: process.env.CORS_ORIGIN!.split(",") }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(apiLimiter);

// Every route except /health requires the gateway's internal secret,
// registered before any route (including "/") so nothing slips past it.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  return requireInternalSecret(req, res, next);
});

app.use("/", router);

const PORT = process.env.PORT || 5002;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Logistics service running on port ${PORT}.`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to DB:", error);
    process.exit(1);
  });
