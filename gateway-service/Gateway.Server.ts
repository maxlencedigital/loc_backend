import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./src/DB/Prisma.Connection.Db.js";
import router from "./src/Routes/Gateway.Routes.js";
import { activityLogger } from "./src/Middleware/ActivityLogger.js";
import { apiLimiter } from "./src/Middleware/RateLimiter.js";
import setupSwagger from "./src/Swagger/Swagger.js";

// DATABASE_URL carries host, user, password and database in one string, so
// the discrete DB_* vars are for local docker-compose only.
const requiredEnvVars = [
  "JWT_SECRET",
  ...(process.env.DATABASE_URL ? [] : ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"]),
  "INTERNAL_SERVICE_SECRET",
  "CORS_ORIGIN",
];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

// A guessable JWT_SECRET is a full auth bypass; a guessable
// INTERNAL_SERVICE_SECRET lets anyone skip the gateway. Fail at boot.
const MIN_SECRET_LENGTH = 32;
const weakSecrets = ["JWT_SECRET", "INTERNAL_SERVICE_SECRET"].filter(
  (key) => (process.env[key] as string).length < MIN_SECRET_LENGTH
);
if (weakSecrets.length > 0) {
  console.error(`${weakSecrets.join(", ")} must be at least ${MIN_SECRET_LENGTH} random characters.`);
  process.exit(1);
}

const app = express();

// Only set behind a real proxy: it makes req.ip trust X-Forwarded-For. Unset
// locally is correct, since there is no proxy in front.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY));
}

// "*" while the frontend team works from localhost and preview URLs. Set
// CORS_ORIGIN to a comma-separated list of real origins before launch.
const corsOrigin = process.env.CORS_ORIGIN as string;
app.use(cors({ origin: corsOrigin === "*" ? "*" : corsOrigin.split(",") }));

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
// A no-op in development, automatic under NODE_ENV=production. Left wired up
// so production cannot end up with no limiter because someone forgot.
app.use(apiLimiter);
app.use(activityLogger("gateway-service"));

// The aggregated 5-service API surface. Off under NODE_ENV=production unless
// ENABLE_DOCS=true, which only the hosted dev environment should ever set.
const docsEnabled = process.env.ENABLE_DOCS === "true" || process.env.NODE_ENV !== "production";
if (docsEnabled) {
  setupSwagger(app);
}

app.get("/", (_req, res) => {
  res.send("Gateway service is running.");
});

app.use("/", router);

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Gateway service running on port ${PORT}.`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to DB:", error);
    process.exit(1);
  });
