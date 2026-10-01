import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  ClaimStatus,
  IClaim,
  IClaimChange,
  IClaimCreate,
  IClaimDetail,
  IClaimEventWrite,
  IClaimFilter,
  IClaimHistory,
} from "../Models/OpsInsurance/Insurance.Interface.js";
import { IPage } from "../Models/OpsVendors/Vendor.Interface.js";
import { fromDbDate, toDbDate } from "../Utils/OpsDates.js";
import type { IDocumentRef } from "../Utils/OpsInput.js";

export type Db = Prisma.TransactionClient;

const CLAIM_COUNTER = "insurance_claim_ref";
const MAX_HISTORY_GROUPS = 500;

const num = (value: bigint | null): number | null => (value === null ? null : Number(value));

const detailInclude = {
  events: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.OpsInsuranceClaimInclude;

const toClaim = (row: Prisma.OpsInsuranceClaimGetPayload<object>): IClaim => ({
  id: row.id,
  number: row.number,
  policyId: row.policyId,
  type: row.type,
  description: row.description,
  incidentDate: fromDbDate(row.incidentDate),
  claimAmountPaise: Number(row.claimAmountPaise),
  incidentId: row.incidentId,
  storeId: row.storeId,
  employeeId: row.employeeId,
  orderId: row.orderId,
  status: row.status,
  insurerReference: row.insurerReference,
  outcome: row.outcome,
  settledAmountPaise: num(row.settledAmountPaise),
  settledAt: row.settledAt,
  documents: row.documents as unknown as IDocumentRef[],
  raisedAt: row.raisedAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
});

const toDetail = (row: Prisma.OpsInsuranceClaimGetPayload<{ include: typeof detailInclude }>): IClaimDetail => ({
  ...toClaim(row),
  events: row.events.map(({ id: _id, claimId: _claimId, byUserId: _byUserId, ...event }) => event),
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const nextNumber = async (db: Db): Promise<string> => {
  try {
    const counter = await db.sequenceCounter.update({
      where: { name: CLAIM_COUNTER },
      data: { value: { increment: 1 } },
    });
    return `CLM-${counter.value}`;
  } catch (error) {
    throw error;
  }
};

const create = async (number: string, data: IClaimCreate, db: Db): Promise<IClaimDetail> => {
  try {
    const { firstEvent, claimAmountPaise, incidentDate, ...claim } = data;
    const row = await db.opsInsuranceClaim.create({
      data: {
        ...claim,
        number,
        incidentDate: toDbDate(incidentDate),
        claimAmountPaise: BigInt(claimAmountPaise),
        events: { create: [{ fromStatus: null, toStatus: "raised", ...firstEvent }] },
      },
      include: detailInclude,
    });
    return toDetail(row);
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IClaimDetail | null> => {
  try {
    const row = await db.opsInsuranceClaim.findUnique({ where: { id }, include: detailInclude });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

const findByIdempotencyKey = async (createdBy: string, key: string, db: Db = prisma): Promise<IClaimDetail | null> => {
  try {
    const row = await db.opsInsuranceClaim.findFirst({
      where: { createdBy, idempotencyKey: key },
      include: detailInclude,
    });
    return row ? toDetail(row) : null;
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IClaimFilter, db: Db = prisma): Promise<IPage<IClaim>> => {
  try {
    const where: Prisma.OpsInsuranceClaimWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.policyId ? { policyId: filter.policyId } : {}),
      ...(filter.from || filter.to
        ? { raisedAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.opsInsuranceClaim.findMany({
        where,
        orderBy: [{ raisedAt: "desc" }, { id: "asc" }],
        skip: filter.offset,
        take: filter.limit,
      }),
      db.opsInsuranceClaim.count({ where }),
    ]);
    return { items: rows.map(toClaim), total };
  } catch (error) {
    throw error;
  }
};

// Conditional change: UPDATE .. WHERE status = expected, and the history row only if it
// matched. False means another request moved the claim first, so the caller refuses with 409.
const change = async (
  id: string,
  expected: ClaimStatus,
  data: IClaimChange,
  event: IClaimEventWrite,
  db: Db
): Promise<boolean> => {
  try {
    const { settledAmountPaise, ...rest } = data;
    const { count } = await db.opsInsuranceClaim.updateMany({
      where: { id, status: expected },
      data: {
        ...rest,
        ...(settledAmountPaise !== undefined ? { settledAmountPaise: BigInt(settledAmountPaise) } : {}),
      },
    });
    if (count === 0) return false;
    await db.opsClaimEvent.create({ data: { claimId: id, ...event } });
    return true;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock, held until the transaction ends.
const lockById = async (id: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.opsInsuranceClaim.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const saveDocuments = async (id: string, documents: IDocumentRef[], db: Db): Promise<void> => {
  try {
    await db.opsInsuranceClaim.update({
      where: { id },
      data: { documents: documents as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    throw error;
  }
};

// Two SQL aggregates: claims grouped by type and status, and the average time to a decision.
const history = async (range: { from?: Date; to?: Date }, db: Db = prisma): Promise<IClaimHistory> => {
  try {
    const where: Prisma.OpsInsuranceClaimWhereInput =
      range.from || range.to
        ? { raisedAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } }
        : {};
    const [groups, decided] = await Promise.all([
      db.opsInsuranceClaim.groupBy({
        by: ["type", "status"],
        where,
        _count: { _all: true },
        _sum: { claimAmountPaise: true, settledAmountPaise: true },
        orderBy: [{ type: "asc" }, { status: "asc" }],
        take: MAX_HISTORY_GROUPS,
      }),
      db.opsInsuranceClaim.aggregate({
        where: { ...where, decisionSeconds: { not: null } },
        _avg: { decisionSeconds: true },
      }),
    ]);
    return {
      rows: groups.map((g) => ({
        type: g.type,
        status: g.status,
        count: g._count._all,
        claimedPaise: Number(g._sum.claimAmountPaise ?? 0n),
        paidPaise: Number(g._sum.settledAmountPaise ?? 0n),
      })),
      averageDecisionSeconds: decided._avg.decisionSeconds,
    };
  } catch (error) {
    throw error;
  }
};

export const OpsClaimQuery = {
  inTransaction,
  nextNumber,
  create,
  findById,
  findByIdempotencyKey,
  list,
  change,
  lockById,
  saveDocuments,
  history,
};
