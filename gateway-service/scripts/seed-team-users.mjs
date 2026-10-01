// Creates the team's dashboard logins — one per dashboard role — in whichever
// database this service is pointed at. Runs on every Render deploy, right after
// the migrations (see render.yaml), and by hand with `npm run db:seed:team`.
//
//   super_admin  -> Super admin   (everything, all stores)
//   admin        -> Admin         (everything except platform-level store setup)
//   manager      -> Store manager (one store: floor, counter, daily close, reports)
//   staff        -> Employee      (one store: orders and the floor screens)
//
// WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN: passwords. This repo is on GitHub
// and the deployed gateway is on the public internet, so a password committed
// here would be a working super-admin login for anyone who can read the repo or
// its history — and git history cannot be un-published. The emails and roles
// below are not secret; the passwords come from environment variables:
//
//   SEED_SUPER_ADMIN_PASSWORD   SEED_ADMIN_PASSWORD
//   SEED_MANAGER_PASSWORD       SEED_STAFF_PASSWORD
//
// or SEED_TEAM_PASSWORD, one shared fallback for any role without its own.
// Set them in Render -> loc-gateway-service -> Environment. An account with no
// password configured is SKIPPED with a warning, never created with a default.
//
// SAFE TO RUN ON EVERY DEPLOY
//   - An account that already exists is left completely alone: its password,
//     role and active flag are never overwritten. Someone who changed their
//     password, or whom you suspended, stays that way after the next deploy.
//   - Changing a password variable therefore does NOT change an existing
//     account's password. To reset one, use the dashboard / API, or delete the
//     row and redeploy.
//
// OPTIONAL
//   SEED_STORE_ID   a commerce store UUID to attach the manager and staff to.
//                   Unset (the default) they have no store yet; an admin assigns one.
import "../dist/commons/Config/LoadEnv.js";
import bcrypt from "bcrypt";

// ---- EDIT THIS TABLE: put the real addresses of the people who will sign in ----
//
// The email is the login. It needs no mailbox to sign in, but "forgot password"
// sends its code there, so use an address that can receive mail if you want that
// to work. Phone numbers only need to be unique; they are never messaged here.
const TEAM = [
  {
    role: "super_admin",
    name: "Simanchala",
    email: "simanchala@maxlence.com.au",
    phoneNumber: "+919876501001",
    passwordVar: "SEED_SUPER_ADMIN_PASSWORD",
  },
  {
    role: "admin",
    name: "LOC Admin",
    email: "admin@loclaundry.in",
    phoneNumber: "+919876501002",
    passwordVar: "SEED_ADMIN_PASSWORD",
  },
  {
    role: "manager",
    name: "LOC Store Manager",
    email: "manager@loclaundry.in",
    phoneNumber: "+919876501003",
    passwordVar: "SEED_MANAGER_PASSWORD",
  },
  {
    role: "staff",
    name: "LOC Employee",
    email: "staff@loclaundry.in",
    phoneNumber: "+919876501004",
    passwordVar: "SEED_STAFF_PASSWORD",
  },
];
// ---------------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 10;
const SALT_ROUNDS = 12;
const STORE_BOUND_ROLES = new Set(["manager", "staff"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const log = (msg) => console.log(`[seed:team] ${msg}`);
const warn = (msg) => console.warn(`[seed:team] WARNING: ${msg}`);

const passwordFor = (member) =>
  process.env[member.passwordVar]?.trim() || process.env.SEED_TEAM_PASSWORD?.trim() || "";

const storeId = process.env.SEED_STORE_ID?.trim() || null;
if (storeId && !UUID.test(storeId)) {
  warn(`SEED_STORE_ID "${storeId}" is not a UUID, so it was ignored.`);
}
const validStoreId = storeId && UUID.test(storeId) ? storeId : null;

// Decide who is creatable BEFORE touching the database, so a deploy with no
// passwords configured exits quickly without opening a connection.
const plan = TEAM.map((member) => {
  const password = passwordFor(member);
  if (!password) return { member, skip: `no password set (${member.passwordVar} or SEED_TEAM_PASSWORD)` };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { member, skip: `password is shorter than ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { member, password };
});

if (plan.every((p) => p.skip)) {
  warn("No team passwords are configured, so no accounts were created.");
  for (const p of plan) log(`  ${p.member.email.padEnd(32)} ${p.member.role.padEnd(12)} skipped: ${p.skip}`);
  log("Set the SEED_*_PASSWORD variables in Render (Environment), then redeploy.");
  process.exit(0);
}

const { prisma, disconnectDB } = await import("../dist/src/DB/Prisma.Connection.Db.js");

let created = 0;
let existing = 0;
let skipped = 0;
let failed = 0;

try {
  for (const item of plan) {
    const { member } = item;
    const email = member.email.toLowerCase().trim();
    const label = `${email.padEnd(32)} ${member.role.padEnd(12)}`;

    if (item.skip) {
      skipped += 1;
      log(`${label} skipped: ${item.skip}`);
      continue;
    }

    try {
      const found = await prisma.user.findUnique({ where: { email } });
      if (found) {
        existing += 1;
        const note = found.role === member.role ? "" : ` (has role ${found.role}, left unchanged)`;
        log(`${label} already exists, left untouched${note}`);
        continue;
      }

      await prisma.user.create({
        data: {
          name: member.name,
          email,
          phoneNumber: member.phoneNumber,
          passwordHash: await bcrypt.hash(item.password, SALT_ROUNDS),
          role: member.role,
          isActive: true,
          storeId: STORE_BOUND_ROLES.has(member.role) ? validStoreId : null,
        },
      });
      created += 1;
      log(`${label} created`);
    } catch (error) {
      // One bad row (e.g. the phone number is taken by someone else) must not
      // stop the other three from being created.
      failed += 1;
      warn(`${email}: ${error instanceof Error ? error.message.split("\n").pop() : error}`);
    }
  }

  log(`done: ${created} created, ${existing} already existed, ${skipped} skipped, ${failed} failed.`);
} catch (error) {
  console.error("[seed:team] Seeding failed:", error instanceof Error ? error.message : error);
  await disconnectDB();
  process.exit(1);
}

// Released explicitly: the pool keeps the process alive otherwise, and a build
// step that never exits hangs the deploy.
await disconnectDB();
process.exit(failed > 0 ? 1 : 0);
