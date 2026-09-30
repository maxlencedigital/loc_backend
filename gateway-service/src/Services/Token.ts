import jwt from "jsonwebtoken";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { UserRole } from "../Models/User/User.Interface.js";

// Pinned on both sign and verify, never left to the library's inference: an
// unconstrained verify is where JWT "alg confusion" bugs start.
export const JWT_ALGORITHM = "HS256";

// Short on purpose: an access token cannot be revoked, so this is how long a
// deactivated or stolen one keeps working. The refresh token carries the session.
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;

export const accessTtlSeconds = (): number => {
  const configured = Number(process.env.ACCESS_TOKEN_TTL_SECONDS);
  return Number.isInteger(configured) && configured >= 60 ? configured : DEFAULT_ACCESS_TTL_SECONDS;
};

// No fallback secret: a service without JWT_SECRET must fail loudly, not sign
// tokens with a value sitting in source control.
export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new CustomException("Server misconfigured: JWT secret missing.", 500);
  }
  return secret;
};

// The name rides along so downstream audit trails can show who acted without a user lookup.
export const signAccessToken = (user: {
  id: string;
  name: string;
  role: UserRole;
  storeId: string | null;
}): string =>
  jwt.sign({ userId: user.id, name: user.name, role: user.role, storeId: user.storeId }, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: accessTtlSeconds(),
  });
