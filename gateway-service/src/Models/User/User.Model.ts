import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../../DB/Sequelize.Connection.Db.js";
import { IUser, UserRole } from "./User.Interface.js";

type UserCreationAttributes = Optional<IUser, "id" | "isActive">;

export class UserModel extends Model<IUser, UserCreationAttributes> implements IUser {
  declare id: string;
  declare name: string;
  declare email: string;
  declare phoneNumber: string;
  declare passwordHash: string;
  declare role: UserRole;
  declare isActive: boolean;
}

UserModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    name: { type: DataTypes.STRING(100), allowNull: false },
    email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    phoneNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role: {
      type: DataTypes.ENUM("admin", "staff", "driver", "customer"),
      allowNull: false,
      defaultValue: "customer",
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "GatewayUser",
    tableName: "gateway_users",
  }
);
