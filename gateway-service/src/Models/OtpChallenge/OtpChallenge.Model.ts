import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../../DB/Sequelize.Connection.Db.js";
import { IOtpChallenge, OtpPurpose } from "./OtpChallenge.Interface.js";

type OtpChallengeCreationAttributes = Optional<
  IOtpChallenge,
  "id" | "attempts" | "verifiedAt" | "consumedAt" | "userId"
>;

export class OtpChallengeModel
  extends Model<IOtpChallenge, OtpChallengeCreationAttributes>
  implements IOtpChallenge
{
  declare id: string;
  declare purpose: OtpPurpose;
  declare destination: string;
  declare otpHash: string;
  declare userId: string | null;
  declare attempts: number;
  declare verifiedAt: Date | null;
  declare consumedAt: Date | null;
  declare expiresAt: Date;
  declare readonly createdAt: Date;
}

OtpChallengeModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    purpose: {
      type: DataTypes.ENUM("register", "login", "password_reset"),
      allowNull: false,
    },
    destination: { type: DataTypes.STRING(150), allowNull: false },
    otpHash: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    verifiedAt: { type: DataTypes.DATE, allowNull: true },
    consumedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    modelName: "OtpChallenge",
    tableName: "otp_challenges",
    updatedAt: false,
    indexes: [
      // Supports the per-destination resend throttle, which counts recent
      // challenges for one phone/email.
      { fields: ["destination", "purpose"], name: "idx_destination_purpose" },
      // Supports the expiry sweep.
      { fields: ["expiresAt"], name: "idx_expires_at" },
    ],
  }
);
