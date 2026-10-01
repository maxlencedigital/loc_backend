import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IOnboardingItem, ITemplateItem, OnboardingStatus } from "../Models/Hr/Employee.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const toItem = ({ updatedByUserId: _by, createdAt: _c, updatedAt: _u, ...item }: IOnboardingItem & {
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): IOnboardingItem => item;

const templateItems = async (role: string, db: Db = prisma): Promise<ITemplateItem[]> => {
  try {
    const rows = await db.hrOnboardingTemplateItem.findMany({
      where: { role },
      orderBy: { position: "asc" },
      select: { title: true, category: true },
    });
    return rows;
  } catch (error) {
    throw error;
  }
};

// Replaces a role's whole checklist: delete and recreate inside the caller's transaction.
const replaceTemplate = async (role: string, items: ITemplateItem[], db: Db): Promise<void> => {
  try {
    await db.hrOnboardingTemplateItem.deleteMany({ where: { role } });
    await db.hrOnboardingTemplateItem.createMany({
      data: items.map((item, position) => ({ role, position, ...item })),
    });
  } catch (error) {
    throw error;
  }
};

const createItems = async (employeeId: string, items: ITemplateItem[], db: Db): Promise<void> => {
  try {
    if (items.length === 0) return;
    await db.hrOnboardingItem.createMany({
      data: items.map((item, position) => ({ employeeId, position, ...item })),
    });
  } catch (error) {
    throw error;
  }
};

const listItems = async (employeeId: string, db: Db = prisma): Promise<IOnboardingItem[]> => {
  try {
    const rows = await db.hrOnboardingItem.findMany({ where: { employeeId }, orderBy: { position: "asc" } });
    return rows.map(toItem);
  } catch (error) {
    throw error;
  }
};

/** Null when the item does not belong to that employee. */
const updateItem = async (
  employeeId: string,
  id: string,
  change: { status: OnboardingStatus; note?: string | null; doneAt: Date | null; updatedByUserId: string },
  db: Db = prisma
): Promise<IOnboardingItem | null> => {
  try {
    const { count } = await db.hrOnboardingItem.updateMany({
      where: { id, employeeId },
      data: {
        status: change.status,
        doneAt: change.doneAt,
        updatedByUserId: change.updatedByUserId,
        ...(change.note !== undefined ? { note: change.note } : {}),
      },
    });
    if (count === 0) return null;
    const row = await db.hrOnboardingItem.findUnique({ where: { id } });
    return row ? toItem(row) : null;
  } catch (error) {
    throw error;
  }
};

export const OnboardingQuery = { templateItems, replaceTemplate, createItems, listItems, updateItem };
