import "dotenv/config";
import bcrypt from "bcrypt";

// Deliberately NOT an HTTP endpoint. /auth/admin-users (super_admin-only)
// covers every account creation after this one — but creating the FIRST
// super_admin needs a path that doesn't depend on a super_admin already
// existing. Requiring direct DB/deploy access here (not just an API
// token) keeps "who can mint the top of the role hierarchy" a strictly
// higher bar than "who can call an authenticated endpoint". Run with
// `npm run seed:super-admin` after `npm run build`.
const { sequelize } = await import("../dist/src/DB/Sequelize.Connection.Db.js");
const { UserModel } = await import("../dist/src/Models/User/User.Model.js");

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

await sequelize.authenticate();
await sequelize.sync({ alter: false });

const normalizedEmail = email.toLowerCase().trim();
const existing = await UserModel.findOne({ where: { email: normalizedEmail } });
if (existing) {
  console.log(`A user with email ${normalizedEmail} already exists (role: ${existing.role}). Nothing to do.`);
  process.exit(0);
}

const passwordHash = await bcrypt.hash(password, 10);
const user = await UserModel.create({
  name,
  email: normalizedEmail,
  phoneNumber,
  passwordHash,
  role: "super_admin",
  isActive: true,
});

console.log(`Created super_admin ${user.email} (id: ${user.id}).`);
process.exit(0);
