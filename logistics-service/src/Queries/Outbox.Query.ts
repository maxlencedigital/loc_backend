import { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IOutbox, IOutboxCreate, OutboxState } from "../Models/Sync/Outbox.Interface.js";
import type { Db } from "./Job.Query.js";

const asOutbox = (row: unknown): IOutbox => row as IOutbox;

/** Writes the row inside the caller's transaction; the same dedupeKey twice is one row. */
const enqueue = async (data: IOutboxCreate, db: Db): Promise<IOutbox> => {
  try {
    const payload = data.payload as Prisma.InputJsonValue;
    return asOutbox(
      await db.outbox.upsert({
        where: { dedupeKey: data.dedupeKey },
        create: { ...data, payload, nextAttemptAt: new Date() },
        update: {},
      })
    );
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string): Promise<IOutbox | null> => {
  try {
    const row = await prisma.outbox.findUnique({ where: { id } });
    return row ? asOutbox(row) : null;
  } catch (error) {
    throw error;
  }
};

/** Pending rows whose time has come, oldest first. */
const listDue = async (now: Date, limit: number): Promise<IOutbox[]> => {
  try {
    const rows = await prisma.outbox.findMany({
      where: { state: "pending", nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(asOutbox);
  } catch (error) {
    throw error;
  }
};

/**
 * Leases a due row to this caller: pushes its next attempt out and counts the attempt.
 * Exactly one concurrent caller gets true, so one row is never delivered twice at once.
 */
const claim = async (id: string, now: Date, leaseUntil: Date): Promise<boolean> => {
  try {
    const { count } = await prisma.outbox.updateMany({
      where: { id, state: "pending", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: leaseUntil, attempts: { increment: 1 } },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const markDone = async (id: string): Promise<void> => {
  try {
    await prisma.outbox.updateMany({ where: { id, state: "pending" }, data: { state: "done", doneAt: new Date(), lastError: null } });
  } catch (error) {
    throw error;
  }
};

const markFailed = async (id: string, error: string, state: OutboxState, nextAttemptAt: Date): Promise<void> => {
  try {
    await prisma.outbox.updateMany({ where: { id, state: "pending" }, data: { state, lastError: error.slice(0, 300), nextAttemptAt } });
  } catch (failure) {
    throw failure;
  }
};

const savePayload = async (id: string, payload: Record<string, unknown>): Promise<void> => {
  try {
    await prisma.outbox.update({ where: { id }, data: { payload: payload as Prisma.InputJsonValue } });
  } catch (error) {
    throw error;
  }
};

export const OutboxQuery = { enqueue, findById, listDue, claim, markDone, markFailed, savePayload };
