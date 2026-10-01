import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IAgreedAction, ICareerGoal, ICareerPath, ICareerPlan } from "../Models/Hr/Career.Interface.js";
import type { Db } from "./Hr.Transaction.js";

type PlanRow = Prisma.HrCareerPlanGetPayload<object>;

const toPlan = (row: PlanRow): ICareerPlan => ({
  employeeId: row.employeeId,
  targetRole: row.targetRole,
  goals: row.goals as unknown as ICareerGoal[],
  skillGaps: row.skillGaps,
  agreedActions: row.agreedActions as unknown as IAgreedAction[],
  lastReviewedAt: row.lastReviewedAt,
});

const findPlan = async (employeeId: string, db: Db = prisma): Promise<ICareerPlan | null> => {
  try {
    const row = await db.hrCareerPlan.findUnique({ where: { employeeId } });
    return row ? toPlan(row) : null;
  } catch (error) {
    throw error;
  }
};

const savePlan = async (
  employeeId: string,
  data: Pick<ICareerPlan, "targetRole" | "goals" | "skillGaps" | "agreedActions">,
  db: Db
): Promise<ICareerPlan> => {
  try {
    const values = {
      targetRole: data.targetRole,
      goals: data.goals as unknown as Prisma.InputJsonValue,
      skillGaps: data.skillGaps,
      agreedActions: data.agreedActions as unknown as Prisma.InputJsonValue,
    };
    return toPlan(
      await db.hrCareerPlan.upsert({ where: { employeeId }, create: { employeeId, ...values }, update: values })
    );
  } catch (error) {
    throw error;
  }
};

/** Appends the review and stamps the plan, in the caller's transaction. Null when there is no plan. */
const recordReview = async (
  employeeId: string,
  review: { note: string; byUserId: string | null; byName: string; at: Date },
  db: Db
): Promise<ICareerPlan | null> => {
  try {
    const { count } = await db.hrCareerPlan.updateMany({ where: { employeeId }, data: { lastReviewedAt: review.at } });
    if (count === 0) return null;
    await db.hrCareerReview.create({
      data: {
        employeeId,
        note: review.note,
        reviewedByUserId: review.byUserId,
        reviewedByName: review.byName,
        reviewedAt: review.at,
      },
    });
    return await findPlan(employeeId, db);
  } catch (error) {
    throw error;
  }
};

const listPaths = async (offset: number, limit: number, db: Db = prisma): Promise<{ items: ICareerPath[]; total: number }> => {
  try {
    const [items, total] = await Promise.all([
      db.hrCareerPath.findMany({
        orderBy: { role: "asc" },
        skip: offset,
        take: limit,
        select: { role: true, nextRoles: true, requirements: true },
      }),
      db.hrCareerPath.count(),
    ]);
    return { items, total };
  } catch (error) {
    throw error;
  }
};

const savePath = async (path: ICareerPath, db: Db = prisma): Promise<ICareerPath> => {
  try {
    return await db.hrCareerPath.upsert({
      where: { role: path.role },
      create: path,
      update: { nextRoles: path.nextRoles, requirements: path.requirements },
      select: { role: true, nextRoles: true, requirements: true },
    });
  } catch (error) {
    throw error;
  }
};

export const CareerQuery = { findPlan, savePlan, recordReview, listPaths, savePath };
