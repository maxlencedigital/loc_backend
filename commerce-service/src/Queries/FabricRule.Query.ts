import { prisma } from "../DB/Prisma.Connection.Db.js";
import { toPage } from "../../commons/Utils/Pagination.js";
import type { Page, PageRequest } from "../../commons/Utils/Pagination.js";
import type { IFabricRule } from "../Models/StoreFloor/StoreFloor.Interface.js";
import type { Db } from "./Floor.Transaction.js";

const toRule = (row: any): IFabricRule => row as IFabricRule;

const search = async (fabric: string | undefined, request: PageRequest, db: Db = prisma): Promise<Page<IFabricRule>> => {
  try {
    const where = fabric ? { fabric } : {};
    const [rows, total] = await Promise.all([
      db.fabricRiskRule.findMany({ where, orderBy: [{ fabric: "asc" }], skip: request.offset, take: request.limit }),
      db.fabricRiskRule.count({ where }),
    ]);
    return toPage(rows.map(toRule), total, request);
  } catch (error) {
    throw error;
  }
};

const findByFabric = async (fabric: string, db: Db = prisma): Promise<IFabricRule | null> => {
  try {
    const row = await db.fabricRiskRule.findUnique({ where: { fabric } });
    return row ? toRule(row) : null;
  } catch (error) {
    throw error;
  }
};

// The rule table is a handful of rows; check-in reads the ones it needs in a single query.
const findByFabrics = async (fabrics: string[], db: Db = prisma): Promise<Map<string, IFabricRule>> => {
  try {
    const rows = await db.fabricRiskRule.findMany({ where: { fabric: { in: fabrics } } });
    return new Map(rows.map((row) => [row.fabric, toRule(row)]));
  } catch (error) {
    throw error;
  }
};

export const FabricRuleQuery = { search, findByFabric, findByFabrics };
