import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IUser, IUserCreate, OAuthProvider } from "../Models/User/User.Interface.js";

// Returns the domain interface, not Prisma's generated type: everything above
// this layer then has no ORM dependency at all.
const create = async (userDetails: IUserCreate): Promise<IUser> => {
  return prisma.user.create({ data: userDetails });
};

const findByEmail = async (email: string): Promise<IUser | null> => {
  return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
};

const findById = async (id: string): Promise<IUser | null> => {
  return prisma.user.findUnique({ where: { id } });
};

const findByPhoneNumber = async (phoneNumber: string): Promise<IUser | null> => {
  return prisma.user.findUnique({ where: { phoneNumber: phoneNumber.trim() } });
};

// Matched before email: a provider's `sub` is stable for the account's life,
// while the email attached to it can be changed by the user.
const findByOAuthIdentity = async (
  provider: OAuthProvider,
  subject: string
): Promise<IUser | null> => {
  return prisma.user.findUnique({
    where: { oauthIdentity: { oauthProvider: provider, oauthSubject: subject } },
  });
};

// Throws if the row is gone rather than reporting success for a write that
// never happened — which a password reset in particular must not swallow.
const setPassword = async (id: string, passwordHash: string): Promise<void> => {
  await prisma.user.update({ where: { id }, data: { passwordHash } });
};

// Links a social identity onto an account that already exists under the same
// email: signed up with a password first, then used "Continue with Google".
const linkOAuthIdentity = async (
  id: string,
  provider: OAuthProvider,
  subject: string
): Promise<void> => {
  await prisma.user.update({
    where: { id },
    data: { oauthProvider: provider, oauthSubject: subject },
  });
};

export const UserQuery = {
  create,
  findByEmail,
  findById,
  findByPhoneNumber,
  findByOAuthIdentity,
  setPassword,
  linkOAuthIdentity,
};
