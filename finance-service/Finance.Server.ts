import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./src/DB/Sequelize.Connection.Db.js";
import router from "./src/Routes/Finance.Routes.js";
import { requireInternalSecret } from "./src/Middleware/Identity.js";
import { apiLimiter } from "./src/Middleware/RateLimiter.js";

const requiredEnvVars = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST", "INTERNAL_SERVICE_SECRET"];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

const app = express();

// Only set when actually behind a real reverse proxy/load balancer.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY));
}

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(apiLimiter);

// Every route except /health requires the gateway's internal secret,
// registered before any route (including "/") so nothing can slip
// past it. This service has no public Swagger UI — it's documented
// as part of the gateway's single aggregated API doc, since clients
// only ever call it through the gateway.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  return requireInternalSecret(req, res, next);
});

app.use("/", router);

const PORT = process.env.PORT || 5003;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Finance service running on port ${PORT}.`);
    });
  })
  .catch((error) => {
    console.error("Failed to connect to DB:", error);
    process.exit(1);
  });
