import { Op } from "sequelize";
import { ActivityLogModel } from "../Models/ActivityLog/ActivityLog.Model.js";
import { IActivityLogCreate } from "../Models/ActivityLog/ActivityLog.Interface.js";

const create = async (entry: IActivityLogCreate): Promise<void> => {
  await ActivityLogModel.create(entry);
};

interface AuditFilter {
  service?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

const search = async (
  filter: AuditFilter
): Promise<{ logs: ActivityLogModel[]; total: number }> => {
  const where: Record<string, any> = {};
  if (filter.service) where.service = filter.service;
  if (filter.userId) where.userId = filter.userId;
  if (filter.from || filter.to) {
    where.createdAt = {};
    if (filter.from) where.createdAt[Op.gte] = filter.from;
    if (filter.to) where.createdAt[Op.lte] = filter.to;
  }
  const offset = (filter.page - 1) * filter.limit;
  const { rows, count } = await ActivityLogModel.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    offset,
    limit: filter.limit,
  });
  return { logs: rows, total: count };
};

export const ActivityLogQuery = { create, search };
