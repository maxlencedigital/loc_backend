import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IEmployeeDocument, IEmployeeDocumentCreate } from "../Models/Hr/Employee.Interface.js";
import type { Db } from "./Hr.Transaction.js";

const create = async (data: IEmployeeDocumentCreate, db: Db = prisma): Promise<IEmployeeDocument> => {
  try {
    return await db.hrEmployeeDocument.create({ data });
  } catch (error) {
    throw error;
  }
};

const list = async (
  employeeId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<{ items: IEmployeeDocument[]; total: number }> => {
  try {
    const where = { employeeId };
    const [items, total] = await Promise.all([
      db.hrEmployeeDocument.findMany({
        where,
        orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.hrEmployeeDocument.count({ where }),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

/** Returns false when the document does not belong to that employee. */
const remove = async (employeeId: string, id: string, db: Db = prisma): Promise<boolean> => {
  try {
    const { count } = await db.hrEmployeeDocument.deleteMany({ where: { id, employeeId } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

export const EmployeeDocumentQuery = { create, list, remove };
