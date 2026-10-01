import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IFabricRuleView } from "../Models/StoreAdmin/StoreAdmin.Interface.js";

export type Db = Prisma.TransactionClient;

// The table belongs to the store-floor module, which reads it at check-in; this is the admin's
// write side. The washing fields below are that module's columns and are set only on create.
export interface IFabricRuleCreate {
  fabric: string;
  risk: string;
  handling: string;
  washProgramme: string;
  dryProgramme: string;
  maxTemperatureC: number;
  cycle: string;
}

export type IFabricRuleChange = Partial<Pick<IFabricRuleCreate, "fabric" | "risk" | "handling">>;

const view = { id: true, fabric: true, risk: true, handling: true, createdAt: true, updatedAt: true } as const;

const create = async (data: IFabricRuleCreate, db: Db = prisma): Promise<IFabricRuleView> => {
  try {
    return await db.fabricRiskRule.create({ data, select: view });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IFabricRuleView | null> => {
  try {
    return await db.fabricRiskRule.findUnique({ where: { id }, select: view });
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IFabricRuleChange, db: Db = prisma): Promise<IFabricRuleView> => {
  try {
    return await db.fabricRiskRule.update({ where: { id }, data, select: view });
  } catch (error) {
    throw error;
  }
};

const remove = async (id: string, db: Db = prisma): Promise<void> => {
  try {
    await db.fabricRiskRule.delete({ where: { id } });
  } catch (error) {
    throw error;
  }
};

export const FabricRiskAdminQuery = { create, findById, update, remove };
