import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IPolicy,
  IPolicyCreate,
  IPolicyFilter,
  IPolicyRenewal,
  IPolicyWrite,
  IRenewalWrite,
} from "../Models/OpsInsurance/Insurance.Interface.js";
import { IPage } from "../Models/OpsVendors/Vendor.Interface.js";
import { fromDbDate, toDbDate } from "../Utils/OpsDates.js";
import type { IDocumentRef } from "../Utils/OpsInput.js";

export type Db = Prisma.TransactionClient;

const num = (value: bigint | null): number | null => (value === null ? null : Number(value));
const big = (value: number | null | undefined): bigint | null | undefined =>
  value === undefined ? undefined : value === null ? null : BigInt(value);

const toPolicy = (row: Prisma.OpsInsurancePolicyGetPayload<object>): IPolicy => ({
  id: row.id,
  type: row.type,
  insurer: row.insurer,
  policyNumber: row.policyNumber,
  coverageAmountPaise: num(row.coverageAmountPaise),
  premiumPaise: num(row.premiumPaise),
  startDate: fromDbDate(row.startDate),
  endDate: fromDbDate(row.endDate),
  covers: row.covers,
  storeIds: row.storeIds,
  employeeIds: row.employeeIds,
  cancelledAt: row.cancelledAt,
  cancelReason: row.cancelReason,
  documents: row.documents as unknown as IDocumentRef[],
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const scopeWhere = (scope: string | null): Prisma.OpsInsurancePolicyWhereInput =>
  scope ? { storeIds: { has: scope } } : {};

const writeData = (data: Partial<IPolicyWrite>) => ({
  ...data,
  ...(data.insurer !== undefined ? { insurerKey: data.insurer.toLowerCase() } : {}),
  coverageAmountPaise: big(data.coverageAmountPaise),
  premiumPaise: big(data.premiumPaise),
  startDate: data.startDate ? toDbDate(data.startDate) : undefined,
  endDate: data.endDate ? toDbDate(data.endDate) : undefined,
});

const create = async (data: IPolicyCreate, db: Db = prisma): Promise<IPolicy> => {
  try {
    const { createdBy, ...fields } = data;
    const row = await db.opsInsurancePolicy.create({
      data: {
        ...writeData(fields),
        createdBy,
        type: data.type,
        insurer: data.insurer,
        insurerKey: data.insurer.toLowerCase(),
        policyNumber: data.policyNumber,
        startDate: toDbDate(data.startDate),
        endDate: toDbDate(data.endDate),
      },
    });
    return toPolicy(row);
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, scope: string | null, db: Db = prisma): Promise<IPolicy | null> => {
  try {
    const row = await db.opsInsurancePolicy.findFirst({ where: { id, ...scopeWhere(scope) } });
    return row ? toPolicy(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock, held until the transaction ends: edits, renewals and
// attachments to one policy queue instead of overwriting each other.
const lockById = async (id: string, scope: string | null, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.opsInsurancePolicy.updateMany({
      where: { id, ...scopeWhere(scope) },
      data: { updatedAt: new Date() },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const update = async (
  id: string,
  data: Partial<IPolicyWrite> & { cancelledAt?: Date | null; cancelReason?: string | null },
  db: Db
): Promise<IPolicy> => {
  try {
    const { cancelledAt, cancelReason, ...fields } = data;
    return toPolicy(
      await db.opsInsurancePolicy.update({
        where: { id },
        data: { ...writeData(fields), cancelledAt, cancelReason },
      })
    );
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IPolicyFilter, db: Db = prisma): Promise<IPage<IPolicy>> => {
  try {
    const where: Prisma.OpsInsurancePolicyWhereInput = {
      ...scopeWhere(filter.storeId),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.cancelled === undefined ? {} : { cancelledAt: filter.cancelled ? { not: null } : null }),
      ...(filter.endFrom || filter.endTo
        ? {
            endDate: {
              ...(filter.endFrom ? { gte: toDbDate(filter.endFrom) } : {}),
              ...(filter.endTo ? { lte: toDbDate(filter.endTo) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.opsInsurancePolicy.findMany({
        where,
        orderBy: [{ endDate: "asc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.opsInsurancePolicy.count({ where }),
    ]);
    return { items: rows.map(toPolicy), total };
  } catch (error) {
    throw error;
  }
};

// Conditional on the end date the caller saw, so two renewals cannot both extend the same
// period. False means the policy changed (or was cancelled) in the meantime.
const renew = async (
  id: string,
  expectedEndDate: string,
  change: { endDate: string; policyNumber: string; premiumPaise: number | null | undefined },
  renewal: IRenewalWrite,
  db: Db
): Promise<boolean> => {
  try {
    const { count } = await db.opsInsurancePolicy.updateMany({
      where: { id, endDate: toDbDate(expectedEndDate), cancelledAt: null },
      data: {
        endDate: toDbDate(change.endDate),
        policyNumber: change.policyNumber,
        ...(change.premiumPaise !== undefined ? { premiumPaise: big(change.premiumPaise) } : {}),
      },
    });
    if (count === 0) return false;
    await db.opsPolicyRenewal.create({
      data: {
        policyId: id,
        ...renewal,
        previousEndDate: toDbDate(renewal.previousEndDate),
        newEndDate: toDbDate(renewal.newEndDate),
        previousPremiumPaise: big(renewal.previousPremiumPaise),
        newPremiumPaise: big(renewal.newPremiumPaise),
      },
    });
    return true;
  } catch (error) {
    throw error;
  }
};

const listRenewals = async (policyId: string, limit: number, db: Db = prisma): Promise<IPolicyRenewal[]> => {
  try {
    const rows = await db.opsPolicyRenewal.findMany({ where: { policyId }, orderBy: { at: "desc" }, take: limit });
    return rows.map((row) => ({
      previousEndDate: fromDbDate(row.previousEndDate),
      newEndDate: fromDbDate(row.newEndDate),
      previousPolicyNumber: row.previousPolicyNumber,
      newPolicyNumber: row.newPolicyNumber,
      previousPremiumPaise: num(row.previousPremiumPaise),
      newPremiumPaise: num(row.newPremiumPaise),
      byName: row.byName,
      at: row.at,
    }));
  } catch (error) {
    throw error;
  }
};

const saveDocuments = async (id: string, documents: IDocumentRef[], db: Db): Promise<IPolicy> => {
  try {
    return toPolicy(
      await db.opsInsurancePolicy.update({
        where: { id },
        data: { documents: documents as unknown as Prisma.InputJsonValue },
      })
    );
  } catch (error) {
    throw error;
  }
};

const countStores = async (ids: string[], db: Db = prisma): Promise<number> => {
  try {
    return await db.store.count({ where: { id: { in: ids } } });
  } catch (error) {
    throw error;
  }
};

// Rider-vehicle policies naming this rider, latest cover first. A handful per rider.
const findRiderPolicies = async (
  riderId: string,
  scope: string | null,
  limit: number,
  db: Db = prisma
): Promise<IPolicy[]> => {
  try {
    const rows = await db.opsInsurancePolicy.findMany({
      where: { type: "rider_vehicle", employeeIds: { has: riderId }, cancelledAt: null, ...scopeWhere(scope) },
      orderBy: [{ endDate: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toPolicy);
  } catch (error) {
    throw error;
  }
};

export const OpsPolicyQuery = {
  inTransaction,
  create,
  findById,
  lockById,
  update,
  list,
  renew,
  listRenewals,
  saveDocuments,
  countStores,
  findRiderPolicies,
};
