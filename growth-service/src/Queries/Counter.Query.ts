import { prisma } from "../DB/Prisma.Connection.Db.js";

// Fixed-window counters for abuse bounds. Three statements, each atomic; a rare race at a
// window boundary can lose one count, which is acceptable for a bound (not for money).
const hit = async (key: string, windowMs: number): Promise<number> => {
  try {
    const now = new Date();
    const windowEndsAt = new Date(now.getTime() + windowMs);
    await prisma.rateCounter.createMany({ data: [{ key, count: 0, windowEndsAt }], skipDuplicates: true });
    await prisma.rateCounter.updateMany({
      where: { key, windowEndsAt: { lte: now } },
      data: { count: 0, windowEndsAt },
    });
    const row = await prisma.rateCounter.update({
      where: { key },
      data: { count: { increment: 1 } },
      select: { count: true },
    });
    if (row.count === 1) {
      // Housekeeping when a window opens: drop counters that expired over an hour ago.
      await prisma.rateCounter.deleteMany({ where: { windowEndsAt: { lt: new Date(now.getTime() - 3_600_000) } } });
    }
    return row.count;
  } catch (error) {
    throw error;
  }
};

export const CounterQuery = { hit };
