import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { Db } from "./Db.js";
import type {
  CampaignStatus,
  ICampaign,
  ICampaignCreate,
  ICampaignFilter,
  ICampaignRecipient,
  ICampaignUpdate,
  RecipientCounts,
  RecipientStatus,
} from "../Models/Campaign/Campaign.Interface.js";

type Paging = { offset: number; limit: number };

const toCampaign = (row: unknown): ICampaign => row as ICampaign;

const create = async (data: ICampaignCreate): Promise<ICampaign> => {
  try {
    return toCampaign(await prisma.campaign.create({ data: { ...data, audience: data.audience as unknown as Prisma.InputJsonValue } }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<ICampaign | null> => {
  try {
    const row = await db.campaign.findUnique({ where: { id } });
    return row ? toCampaign(row) : null;
  } catch (error) {
    throw error;
  }
};

const list = async (filter: ICampaignFilter, paging: Paging): Promise<{ items: ICampaign[]; total: number }> => {
  try {
    const where: Prisma.CampaignWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.channel ? { channel: filter.channel } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.campaign.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.campaign.count({ where }),
    ]);
    return { items: items.map(toCampaign), total };
  } catch (error) {
    throw error;
  }
};

/** Edits only while the campaign is still in one of the `from` states (checked in the WHERE). */
const updateIn = async (id: string, from: CampaignStatus[], data: ICampaignUpdate): Promise<boolean> => {
  try {
    const { count } = await prisma.campaign.updateMany({
      where: { id, status: { in: from } },
      data: { ...data, ...(data.audience ? { audience: data.audience as unknown as Prisma.InputJsonValue } : { audience: undefined }) },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

/** Status transition: the allowed source states are in the WHERE, so a race has one winner. */
const transition = async (
  id: string,
  from: CampaignStatus[],
  to: CampaignStatus,
  extra: { scheduledAt?: Date | null; startedAt?: Date; completedAt?: Date; cancelledAt?: Date } = {}
): Promise<boolean> => {
  try {
    const { count } = await prisma.campaign.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...extra, ...(to === "sending" ? {} : { leaseUntil: null }) },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const acquireLease = async (id: string, now: Date, until: Date): Promise<boolean> => {
  try {
    const { count } = await prisma.campaign.updateMany({
      where: { id, status: "sending", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: until },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const releaseLease = async (id: string): Promise<void> => {
  try {
    await prisma.campaign.updateMany({ where: { id }, data: { leaseUntil: null } });
  } catch (error) {
    throw error;
  }
};

/** Rows left in `sending` belong to a runner that died: never retried, so nobody is messaged twice. */
const failInterrupted = async (campaignId: string): Promise<number> => {
  try {
    const { count } = await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: "sending" },
      data: { status: "failed", error: "interrupted before the result was known; not retried to avoid a duplicate" },
    });
    return count;
  } catch (error) {
    throw error;
  }
};

const pendingRecipients = async (campaignId: string, limit: number): Promise<ICampaignRecipient[]> => {
  try {
    return (await prisma.campaignRecipient.findMany({
      where: { campaignId, status: "pending" },
      orderBy: { customerId: "asc" },
      take: limit,
    })) as ICampaignRecipient[];
  } catch (error) {
    throw error;
  }
};

/** Records a claimed batch and moves the cursor in one transaction. */
const claimBatch = async (campaignId: string, customerIds: string[], cursor: string, db: Db): Promise<void> => {
  try {
    await db.campaignRecipient.createMany({
      data: customerIds.map((customerId) => ({ campaignId, customerId })),
      skipDuplicates: true,
    });
    await db.campaign.update({
      where: { id: campaignId },
      data: { cursor, claimedCount: { increment: customerIds.length } },
    });
  } catch (error) {
    throw error;
  }
};

const markSending = async (campaignId: string, customerIds: string[]): Promise<void> => {
  try {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, customerId: { in: customerIds }, status: "pending" },
      data: { status: "sending" },
    });
  } catch (error) {
    throw error;
  }
};

const setRecipientStatus = async (
  campaignId: string,
  customerIds: string[],
  status: RecipientStatus,
  error: string | null
): Promise<void> => {
  try {
    if (customerIds.length === 0) return;
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, customerId: { in: customerIds }, status: "sending" },
      data: { status, error },
    });
  } catch (err) {
    throw err;
  }
};

const recipientCounts = async (campaignId: string): Promise<RecipientCounts> => {
  try {
    const groups = await prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as RecipientCounts;
  } catch (error) {
    throw error;
  }
};

export const CampaignQuery = {
  create,
  findById,
  list,
  updateIn,
  transition,
  acquireLease,
  releaseLease,
  failInterrupted,
  pendingRecipients,
  claimBatch,
  markSending,
  setRecipientStatus,
  recipientCounts,
};
