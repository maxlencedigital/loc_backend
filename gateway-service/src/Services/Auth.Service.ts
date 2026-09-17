import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserQuery } from "../Queries/User.Query.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, conflict, unauthorized } from "../../commons/Utils/StatusCode.js";
import { UserRole } from "../Models/User/User.Interface.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const SALT_ROUNDS = 10;

/**
 * No hardcoded fallback secret — a service without JWT_SECRET
 * set must fail loudly, not silently sign tokens with a value
 * that's sitting in source control.
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new CustomException("Server misconfigured: JWT secret missing.", 500);
  }
  return secret;
};

const validateNewUserInput = (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
}) => {
  if (!input.name?.trim() || !input.phoneNumber?.trim()) {
    throw new CustomException("Name and phone number are required.", badRequest);
  }
  if (!input.email || !EMAIL_PATTERN.test(input.email.trim())) {
    throw new CustomException("A valid email address is required.", badRequest);
  }
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
    throw new CustomException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      badRequest
    );
  }
};

const createUserRecord = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}) => {
  const existing = await UserQuery.findByEmail(input.email);
  if (existing) {
    throw new CustomException("An account with this email already exists.", conflict);
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  try {
    const user = await UserQuery.create({
      name: input.name.trim(),
      email: input.email.trim(),
      phoneNumber: input.phoneNumber.trim(),
      passwordHash,
      role: input.role,
      isActive: true,
    });
    return { id: user.id, email: user.email, role: user.role };
  } catch (error: any) {
    // Two concurrent registrations for the same email can both pass the
    // findByEmail check above; the DB's unique constraint is the real
    // guard, so translate its rejection into the same 409 instead of a
    // generic 500.
    if (error?.name === "SequelizeUniqueConstraintError") {
      throw new CustomException("An account with this email already exists.", conflict);
    }
    throw error;
  }
};

/**
 * Public self-registration input. There is deliberately no `role` field:
 * every self-registered account is a "customer". Elevated roles
 * (admin/staff/driver) must be granted separately by an already-authenticated
 * super_admin — never accepted from an anonymous request body, or any caller
 * could register as `role: "admin"` and inherit full access system-wide
 * (every downstream service trusts the gateway-issued x-user-role header
 * as-is).
 */
const register = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
}) => {
  validateNewUserInput(input);
  return createUserRecord({ ...input, role: "customer" });
};

const PRIVILEGED_ROLES_CREATABLE_VIA_API: UserRole[] = ["admin", "staff", "driver"];

/**
 * super_admin-only: create an admin/staff/driver account. Deliberately
 * cannot create another super_admin — that tier is seeded only via
 * scripts/seed-super-admin.mjs, which requires direct DB/deploy access,
 * not just an API token. Keeps "who can mint the top of the hierarchy"
 * a strictly higher bar than "who can call an authenticated endpoint".
 */
const createPrivilegedUser = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role: UserRole;
}) => {
  if (!PRIVILEGED_ROLES_CREATABLE_VIA_API.includes(input.role)) {
    throw new CustomException(
      `role must be one of: ${PRIVILEGED_ROLES_CREATABLE_VIA_API.join(", ")}.`,
      badRequest
    );
  }
  validateNewUserInput(input);
  return createUserRecord(input);
};

const login = async (email: string, password: string) => {
  if (!email || !password) {
    throw new CustomException("Email and password are required.", badRequest);
  }
  const user = await UserQuery.findByEmail(email);
  if (!user || !user.isActive) {
    throw new CustomException("Invalid email or password.", unauthorized);
  }
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new CustomException("Invalid email or password.", unauthorized);
  }
  const token = jwt.sign({ userId: user.id, role: user.role }, getJwtSecret(), {
    expiresIn: "12h",
  });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
};

const verifyToken = (token: string): { userId: string; role: UserRole } => {
  try {
    return jwt.verify(token, getJwtSecret()) as { userId: string; role: UserRole };
  } catch {
    throw new CustomException("Invalid or expired token.", unauthorized);
  }
};

export const AuthService = { register, login, verifyToken, createPrivilegedUser };
