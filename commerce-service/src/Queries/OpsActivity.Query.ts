import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IActivity, IActivityCreate, IActivityFilter } from "../Models/Ops/Activity.Interface.js";
import { Db, visibleStores } from "./OpsCompliance.Db.js";

const toActivity = (row: Prisma.OpsActivityGetPayload<object>): IActivity => ({
  ...row,
  entity: row.entity as IActivity["entity"],
  detail: (row.detail as Record<string, unknown> | null) ?? null,
});

// History is append-only: this module has no update and no delete on purpose.
const append = async (data: IActivityCreate, db: Db = prisma): Promise<void> => {
  try {
    await db.opsActivity.create({
      data: { ...data, detail: (data.detail ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  } catch (error) {
    throw error;
  }
};

// The newest `limit` rows, returned oldest first so a timeline reads top to bottom.
const forEntity = async (entity: string, entityId: string, limit: number, db: Db = prisma): Promise<IActivity[]> => {
  try {
    const rows = await db.opsActivity.findMany({
      where: { entity, entityId },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(toActivity).reverse();
  } catch (error) {
    throw error;
  }
};

// One query for many entities (the escalated list), so there is no query per incident.
const forEntities = async (
  entity: string,
  entityIds: string[],
  action: string,
  limit: number,
  db: Db = prisma
): Promise<IActivity[]> => {
  try {
    if (entityIds.length === 0) return [];
    const rows = await db.opsActivity.findMany({
      where: { entity, action, entityId: { in: entityIds } },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toActivity);
  } catch (error) {
    throw error;
  }
};

const search = async (
  filter: IActivityFilter,
  page: { offset: number; limit: number },
  db: Db = prisma
): Promise<{ items: IActivity[]; total: number }> => {
  try {
    const where: Prisma.OpsActivityWhereInput = {
      at: { gte: filter.from, lt: filter.to },
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.entity ? { entity: filter.entity } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...visibleStores(filter.scope),
    };
    const [rows, total] = await Promise.all([
      db.opsActivity.findMany({
        where,
        orderBy: [{ at: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      }),
      db.opsActivity.count({ where }),
    ]);
    return { items: rows.map(toActivity), total };
  } catch (error) {
    throw error;
  }
};

export const OpsActivityQuery = { append, forEntity, forEntities, search };
