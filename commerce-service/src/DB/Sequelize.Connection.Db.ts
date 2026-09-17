import { Sequelize } from "sequelize";

const requiredVars = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"] as const;
const missing = requiredVars.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
}

export const sequelize = new Sequelize(
  process.env.DB_NAME as string,
  process.env.DB_USER as string,
  process.env.DB_PASSWORD as string,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    dialect: "mysql",
    logging: false,
    define: {
      timestamps: true,
    },
    timezone: "+00:00",
  }
);

export const connectDB = async (): Promise<void> => {
  await sequelize.authenticate();
  console.log("Connected to MySQL.");
  // Fine while this service has no entities yet. Once real tables
  // exist with data, replace this with real migrations instead of auto-sync.
  await sequelize.sync({ alter: false });
};
