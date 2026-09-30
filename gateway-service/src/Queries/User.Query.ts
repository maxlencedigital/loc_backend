import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IUser, IUserCreate, OAuthProvider, UserRole } from "../Models/User/User.Interface.js";

// Returns the domain interface, not Prisma's generated type: everything above
// this layer then has no ORM dependency at all.
const create = async (userDetails: IUserCreate): Promise<IUser> => {
  try {
    return await prisma.user.create({ data: userDetails });
  } catch (error) {
    throw error;
  }
};

const findByEmail = async (email: string): Promise<IUser | null> => {
  try {
    return await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string): Promise<IUser | null> => {
  try {
    return await prisma.user.findUnique({ where: { id } });
  } catch (error) {
    throw error;
  }
};

const findByPhoneNumber = async (phoneNumber: string): Promise<IUser | null> => {
  try {
    return await prisma.user.findUnique({ where: { phoneNumber: phoneNumber.trim() } });
  } catch (error) {
    throw error;
  }
};

// Matched before email: a provider's `sub` is stable for the account's life,
// while the email attached to it can be changed by the user.
const findByOAuthIdentity = async (
  provider: OAuthProvider,
  subject: string
): Promise<IUser | null> => {
  try {
    return await prisma.user.findUnique({
      where: { oauthIdentity: { oauthProvider: provider, oauthSubject: subject } },
    });
  } catch (error) {
    throw error;
  }
};

// Throws if the row is gone rather than reporting success for a write that
// never happened — which a password reset in particular must not swallow.
const setPassword = async (id: string, passwordHash: string): Promise<void> => {
  try {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
  } catch (error) {
    throw error;
  }
};

// Links a social identity onto an account that already exists under the same
// email: signed up with a password first, then used "Continue with Google".
const linkOAuthIdentity = async (
  id: string,
  provider: OAuthProvider,
  subject: string
): Promise<void> => {
  try {
    await prisma.user.update({
      where: { id },
      data: { oauthProvider: provider, oauthSubject: subject },
    });
  } catch (error) {
    throw error;
  }
};

// Stamped on the same write that returns the row, so the login response carries the new value.
const recordLogin = async (id: string): Promise<IUser> => {
  try {
    return await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  } catch (error) {
    throw error;
  }
};

export interface UserSearchFilter {
  roles: UserRole[];
  storeId?: string;
  q?: string;
}

const search = async (filter: UserSearchFilter): Promise<IUser[]> => {
  try {
    const term = filter.q?.trim();
    return await prisma.user.findMany({
      where: {
        role: { in: filter.roles },
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { email: { contains: term, mode: "insensitive" } },
                { phoneNumber: { contains: term } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  } catch (error) {
    throw error;
  }
};

export interface UserProfilePatch {
  name?: string;
  phoneNumber?: string;
  role?: UserRole;
  storeId?: string | null;
}

const updateProfile = async (id: string, patch: UserProfilePatch): Promise<IUser> => {
  try {
    return await prisma.user.update({ where: { id }, data: patch });
  } catch (error) {
    throw error;
  }
};

const setActive = async (id: string, isActive: boolean): Promise<IUser> => {
  try {
    return await prisma.user.update({ where: { id }, data: { isActive } });
  } catch (error) {
    throw error;
  }
};

const countActiveByRole = async (role: UserRole): Promise<number> => {
  try {
    return await prisma.user.count({ where: { role, isActive: true } });
  } catch (error) {
    throw error;
  }
};

export const UserQuery = {
  create,
  findByEmail,
  findById,
  findByPhoneNumber,
  findByOAuthIdentity,
  setPassword,
  linkOAuthIdentity,
  recordLogin,
  search,
  updateProfile,
  setActive,
  countActiveByRole,
};
