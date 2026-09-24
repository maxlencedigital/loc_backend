import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../../DB/Sequelize.Connection.Db.js";
import { IUser, UserRole, OAuthProvider } from "./User.Interface.js";

type UserCreationAttributes = Optional<
  IUser,
  "id" | "isActive" | "passwordHash" | "phoneNumber" | "isPhoneVerified" | "oauthProvider" | "oauthSubject"
>;

export class UserModel extends Model<IUser, UserCreationAttributes> implements IUser {
  declare id: string;
  declare name: string;
  declare email: string;
  declare passwordHash: string | null;
  declare phoneNumber: string | null;
  declare isPhoneVerified: boolean;
  declare oauthProvider: OAuthProvider | null;
  declare oauthSubject: string | null;
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
    passwordHash: { type: DataTypes.STRING, allowNull: true },
    phoneNumber: { type: DataTypes.STRING(20), allowNull: true, unique: true },
    isPhoneVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    oauthProvider: {
      type: DataTypes.ENUM("google", "facebook", "apple"),
      allowNull: true,
    },
    oauthSubject: { type: DataTypes.STRING(255), allowNull: true },
    role: {
      type: DataTypes.ENUM("super_admin", "admin", "staff", "driver", "customer"),
      allowNull: false,
      defaultValue: "customer",
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    modelName: "GatewayUser",
    tableName: "gateway_users",
    indexes: [
      // One account per provider identity. Without this, two concurrent
      // first-time social logins could both create an account for the same
      // Google user.
      { unique: true, fields: ["oauthProvider", "oauthSubject"], name: "uniq_oauth_identity" },
    ],
  }
);
