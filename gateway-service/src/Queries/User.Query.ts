import { UserModel } from "../Models/User/User.Model.js";
import { IUserCreate } from "../Models/User/User.Interface.js";

const create = async (userDetails: IUserCreate): Promise<UserModel> => {
  return UserModel.create(userDetails);
};

const findByEmail = async (email: string): Promise<UserModel | null> => {
  return UserModel.findOne({ where: { email: email.toLowerCase().trim() } });
};

const findById = async (id: string): Promise<UserModel | null> => {
  return UserModel.findByPk(id);
};

export const UserQuery = { create, findByEmail, findById };
