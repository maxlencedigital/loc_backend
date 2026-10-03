import { prisma } from "../DB/Prisma.Connection.Db.js";
import { EssOperation, IIdempotencyClaim } from "../Models/Ess/Ess.Interface.js";
import { isUniqueViolation } from "./DatabaseError.js";

/** Inserts the claim; null when the (employee, operation, key) is already taken. */
const insert = async (employeeId: string, operation: EssOperation, key: string): Promise<IIdempotencyClaim | null> => {
  try {
    const row = await prisma.essIdempotencyKey.create({ data: { employeeId, operation, key } });
    return { id: row.id, resourceId: row.resourceId };
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
};

const find = async (employeeId: string, operation: EssOperation, key: string): Promise<IIdempotencyClaim | null> => {
  try {
    const row = await prisma.essIdempotencyKey.findUnique({
      where: { employeeId_operation_key: { employeeId, operation, key } },
      select: { id: true, resourceId: true },
    });
    return row ?? null;
  } catch (error) {
    throw error;
  }
};

/** Frees a claim whose first request never finished (crashed or timed out). True when one was freed. */
const releaseStale = async (employeeId: string, operation: EssOperation, key: string, olderThan: Date): Promise<boolean> => {
  try {
    const { count } = await prisma.essIdempotencyKey.deleteMany({
      where: { employeeId, operation, key, resourceId: null, createdAt: { lt: olderThan } },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const setResource = async (id: string, resourceId: string): Promise<void> => {
  try {
    await prisma.essIdempotencyKey.updateMany({ where: { id, resourceId: null }, data: { resourceId } });
  } catch (error) {
    throw error;
  }
};

/** Removes an unfinished claim after its create failed, so the client may retry. */
const release = async (id: string): Promise<void> => {
  try {
    await prisma.essIdempotencyKey.deleteMany({ where: { id, resourceId: null } });
  } catch (error) {
    throw error;
  }
};

export const EssIdempotencyQuery = { insert, find, releaseStale, setResource, release };
