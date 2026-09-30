import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IActivityLog, IActivityLogCreate } from "../Models/ActivityLog/ActivityLog.Interface.js";

const create = async (entry: IActivityLogCreate): Promise<void> => {
  try {
    await prisma.activityLog.create({ data: entry });
  } catch (error) {
    throw error;
  }
};

interface AuditFilter {
  service?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

const search = async (filter: AuditFilter): Promise<{ logs: IActivityLog[]; total: number }> => {
  try {
    const where: Prisma.ActivityLogWhereInput = {};
    if (filter.service) where.service = filter.service;
    if (filter.userId) where.userId = filter.userId;
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      };
    }

    // One round trip for page and count: run separately, a write landing between
    // them reports a total that disagrees with the rows returned.
    const [logs, total] = await prisma.$transaction([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      prisma.activityLog.count({ where }),
    ]);

    return { logs, total };
  } catch (error) {
    throw error;
  }
};

export const ActivityLogQuery = { create, search };
