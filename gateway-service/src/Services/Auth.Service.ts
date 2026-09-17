import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserQuery } from "../Queries/User.Query.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { conflict, unauthorized } from "../../commons/Utils/StatusCode.js";
import { UserRole } from "../Models/User/User.Interface.js";

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

const register = async (input: {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  role?: UserRole;
}) => {
  const existing = await UserQuery.findByEmail(input.email);
  if (existing) {
    throw new CustomException("An account with this email already exists.", conflict);
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await UserQuery.create({
    name: input.name,
    email: input.email,
    phoneNumber: input.phoneNumber,
    passwordHash,
    role: input.role || "customer",
    isActive: true,
  });
  return { id: user.id, email: user.email, role: user.role };
};

const login = async (email: string, password: string) => {
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

export const AuthService = { register, login, verifyToken };
