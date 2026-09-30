import "dotenv/config";
import { applyEnvironment } from "./Environment.js";

// Import this first in every entry point: it loads .env, then applies IS_LOCAL.
console.log(`[env] running in ${applyEnvironment(process.env)} mode`);
