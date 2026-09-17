import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../../DB/Sequelize.Connection.Db.js";
import { IActivityLog } from "./ActivityLog.Interface.js";

type ActivityLogCreationAttributes = Optional<IActivityLog, "id">;

export class ActivityLogModel
  extends Model<IActivityLog, ActivityLogCreationAttributes>
  implements IActivityLog
{
  declare id: string;
  declare service: string;
  declare method: string;
  declare path: string;
  declare userId: string | null;
  declare statusCode: number;
  declare ip: string | null;
  declare readonly createdAt: Date;
}

ActivityLogModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    service: { type: DataTypes.STRING(50), allowNull: false },
    method: { type: DataTypes.STRING(10), allowNull: false },
    path: { type: DataTypes.STRING(255), allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
    statusCode: { type: DataTypes.INTEGER, allowNull: false },
    ip: { type: DataTypes.STRING(45), allowNull: true },
  },
  {
    sequelize,
    modelName: "ActivityLog",
    tableName: "activity_logs",
    updatedAt: false,
  }
);
