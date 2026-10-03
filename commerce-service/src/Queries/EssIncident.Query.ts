import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IMyIncident } from "../Models/Ess/Ess.Interface.js";

// Reads the incident table of the safety package, only the columns a reporter sees about their own reports.
const listReportedBy = async (userId: string, page: { offset: number; limit: number }): Promise<{ items: IMyIncident[]; total: number }> => {
  try {
    const where = { reportedBy: userId };
    const [items, total] = await Promise.all([
      prisma.safetyIncident.findMany({
        where,
        select: { id: true, type: true, severity: true, status: true, occurredAt: true, location: true, createdAt: true },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        skip: page.offset,
        take: page.limit,
      }),
      prisma.safetyIncident.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

export const EssIncidentQuery = { listReportedBy };
