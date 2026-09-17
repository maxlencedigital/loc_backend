import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./src/DB/Sequelize.Connection.Db.js";
import router from "./src/Routes/Gateway.Routes.js";
import { activityLogger } from "./src/Middleware/ActivityLogger.js";
import { apiLimiter } from "./src/Middleware/RateLimiter.js";
import setupSwagger from "./src/Swagger/Swagger.js";

const requiredEnvVars = [
  "JWT_SECRET",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_HOST",
  "INTERNAL_SERVICE_SECRET",
  "CORS_ORIGIN",
];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

// A short/guessable secret here is a full auth bypass (JWT_SECRET) or
// lets anyone skip the gateway entirely (INTERNAL_SERVICE_SECRET) — fail
// at boot, not silently accept whatever's in the env.
const MIN_SECRET_LENGTH = 32;
const weakSecrets = ["JWT_SECRET", "INTERNAL_SERVICE_SECRET"].filter(
  (key) => (process.env[key] as string).length < MIN_SECRET_LENGTH
);
if (weakSecrets.length > 0) {
  console.error(
    `${weakSecrets.join(", ")} must be at least ${MIN_SECRET_LENGTH} random characters.`
  );
  process.exit(1);
}

const app = express();

// Only set when actually behind a real reverse proxy/load balancer in
// a real deployment — this makes req.ip (and therefore rate limiting)
// trust the proxy's X-Forwarded-For. Leaving it unset in local dev is
// correct: there's no proxy in front, so req.ip is already accurate.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY));
}

app.use(cors({ origin: process.env.CORS_ORIGIN!.split(",") }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(apiLimiter);
app.use(activityLogger("gateway-service"));

// Full aggregated 5-service API surface — dev/staging only, never in production.
if (process.env.NODE_ENV !== "production") {
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
