// Local demo accounts for the LOC dashboard. Every account signs in with the
// password below; it is a documented demo credential for a laptop database, not
// a secret, which is why the script refuses to run anywhere else.
//
//   password for all demo users:  LocDemo#2026
//
// Run `npm run db:seed` (it builds first). Safe to repeat: accounts are upserted by email.
import "../dist/commons/Config/LoadEnv.js";
import bcrypt from "bcrypt";
import fs from "fs";

if (process.env.IS_LOCAL !== "true") {
  console.error("Refusing to seed demo users: IS_LOCAL is not 'true'. This script is for a local database only.");
  process.exit(1);
}

const { prisma, disconnectDB } = await import("../dist/src/DB/Prisma.Connection.Db.js");

const DEMO_PASSWORD = "LocDemo#2026";
const SALT_ROUNDS = 12;

// Shared with the commerce seed, which creates the stores under these ids.
const storeIds = JSON.parse(
  fs.readFileSync(new URL("./demo-store-ids.json", import.meta.url), "utf8")
);

// Names and stores mirror `users` in Dashboard/src/data/dataset.ts. Its st_01..st_03 are the
// live stores, taken in order as BLR-IND, BLR-KOR, BLR-WFD; its planned st_04 has no staff.
// That file's "invited" user has no gateway equivalent, so he is seeded active.
const DEMO_USERS = [
  { name: "Anita Raghavan", role: "super_admin", store: null, active: true },
  { name: "Vikram Shetty", role: "admin", store: null, active: true },
  { name: "Meera Nair", role: "manager", store: "BLR-IND", active: true },
  { name: "Rohan Desai", role: "manager", store: "BLR-KOR", active: true },
  { name: "Priya Iyer", role: "manager", store: "BLR-WFD", active: true },
  { name: "Sanjay Kulkarni", role: "staff", store: "BLR-IND", active: true },
  { name: "Farah Khan", role: "staff", store: "BLR-IND", active: true },
  { name: "Dinesh Pillai", role: "staff", store: "BLR-IND", active: true },
  { name: "Grace Dsouza", role: "staff", store: "BLR-KOR", active: true },
  { name: "Imran Sheikh", role: "staff", store: "BLR-KOR", active: true },
  { name: "Kavya Rao", role: "staff", store: "BLR-WFD", active: true },
  { name: "Nikhil Bhat", role: "staff", store: "BLR-IND", active: true },
  { name: "Tara Menon", role: "staff", store: "BLR-KOR", active: false },
];

const emailFor = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@loclaundry.in`;

try {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);

  for (const [index, demo] of DEMO_USERS.entries()) {
    const storeId = demo.store ? storeIds[demo.store] : null;
    if (demo.store && !storeId) {
      throw new Error(`No store id for ${demo.store} in scripts/demo-store-ids.json.`);
    }
    const fields = {
      name: demo.name,
      // Distinct and E.164-shaped, so the unique index and the validator are both satisfied.
      phoneNumber: `+9198765${String(index + 1).padStart(5, "0")}`,
      passwordHash,
      role: demo.role,
      storeId,
      isActive: demo.active,
    };
    const email = emailFor(demo.name);
    await prisma.user.upsert({ where: { email }, update: fields, create: { email, ...fields } });
    console.log(`${email.padEnd(34)} ${demo.role.padEnd(11)} ${demo.store ?? "-"}${demo.active ? "" : " (suspended)"}`);
  }
  console.log(`Seeded ${DEMO_USERS.length} demo users.`);
} catch (error) {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  await disconnectDB();
  process.exit(1);
}

// Released explicitly: the pool keeps the process alive otherwise.
await disconnectDB();
process.exit(0);
