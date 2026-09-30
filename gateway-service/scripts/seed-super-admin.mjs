import "../dist/commons/Config/LoadEnv.js";
import bcrypt from "bcrypt";

// Deliberately NOT an HTTP endpoint: requiring deploy access is a higher bar
// than an API token. Run `npm run db:migrate` first — this creates no tables.
const { prisma, disconnectDB } = await import("../dist/src/DB/Prisma.Connection.Db.js");

const MIN_PASSWORD_LENGTH = 8;

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const name = process.env.SUPER_ADMIN_NAME || "Super Admin";
const phoneNumber = process.env.SUPER_ADMIN_PHONE || "0000000000";

if (!email || !password) {
  console.error("Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before running this script.");
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const normalizedEmail = email.toLowerCase().trim();

try {
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    console.log(
      `A user with email ${normalizedEmail} already exists (role: ${existing.role}). Nothing to do.`
    );
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        phoneNumber,
        passwordHash,
        role: "super_admin",
        isActive: true,
      },
    });
    console.log(`Created super_admin ${user.email} (id: ${user.id}).`);
  }
} catch (error) {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  await disconnectDB();
  process.exit(1);
}

// Released explicitly: the pool keeps the process alive otherwise, and a seed
// script that never exits will hang a deploy step waiting on it.
await disconnectDB();
process.exit(0);
