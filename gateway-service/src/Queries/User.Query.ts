import { UserModel } from "../Models/User/User.Model.js";
import { IUserCreate, OAuthProvider } from "../Models/User/User.Interface.js";

const create = async (userDetails: IUserCreate): Promise<UserModel> => {
  return UserModel.create(userDetails);
};

const findByEmail = async (email: string): Promise<UserModel | null> => {
  return UserModel.findOne({ where: { email: email.toLowerCase().trim() } });
};

const findById = async (id: string): Promise<UserModel | null> => {
  return UserModel.findByPk(id);
};

const findByPhoneNumber = async (phoneNumber: string): Promise<UserModel | null> => {
  return UserModel.findOne({ where: { phoneNumber: phoneNumber.trim() } });
};

/**
 * Matched on before email, because a provider's `sub` is stable for the life
 * of the account while the email attached to it can be changed by the user.
 */
const findByOAuthIdentity = async (
  provider: OAuthProvider,
  subject: string
): Promise<UserModel | null> => {
  return UserModel.findOne({ where: { oauthProvider: provider, oauthSubject: subject } });
};

const setPassword = async (id: string, passwordHash: string): Promise<void> => {
  await UserModel.update({ passwordHash }, { where: { id } });
};

/**
 * Links a social identity onto an account that already exists under the same
 * email (signed up with a password first, then used "Continue with Google").
 */
const linkOAuthIdentity = async (
  id: string,
  provider: OAuthProvider,
  subject: string
): Promise<void> => {
  await UserModel.update({ oauthProvider: provider, oauthSubject: subject }, { where: { id } });
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
