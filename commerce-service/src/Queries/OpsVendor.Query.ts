import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import {
  IAgreement,
  IAgreementCreate,
  IPage,
  IVendor,
  IVendorCreate,
  IVendorFilter,
  IVendorUpdate,
} from "../Models/OpsVendors/Vendor.Interface.js";
import { fromDbDate, toDbDate } from "../Utils/OpsDates.js";
import type { IDocumentRef } from "../Utils/OpsInput.js";

export type Db = Prisma.TransactionClient;

const toVendor = ({ createdBy: _createdBy, deactivatedBy: _deactivatedBy, ...vendor }: Prisma.OpsVendorGetPayload<object>): IVendor =>
  vendor;

const toAgreement = ({ createdBy: _createdBy, ...row }: Prisma.OpsVendorAgreementGetPayload<object>): IAgreement => ({
  ...row,
  startDate: fromDbDate(row.startDate),
  endDate: row.endDate ? fromDbDate(row.endDate) : null,
  documents: row.documents as unknown as IDocumentRef[],
});

const inTransaction = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(work);
  } catch (error) {
    throw error;
  }
};

const create = async (data: IVendorCreate, db: Db = prisma): Promise<IVendor> => {
  try {
    return toVendor(await db.opsVendor.create({ data }));
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string, db: Db = prisma): Promise<IVendor | null> => {
  try {
    const row = await db.opsVendor.findUnique({ where: { id } });
    return row ? toVendor(row) : null;
  } catch (error) {
    throw error;
  }
};

// One query for a whole report's vendors, never one per row.
const findByIds = async (ids: string[], db: Db = prisma): Promise<IVendor[]> => {
  try {
    return (await db.opsVendor.findMany({ where: { id: { in: ids } } })).map(toVendor);
  } catch (error) {
    throw error;
  }
};

const list = async (filter: IVendorFilter, db: Db = prisma): Promise<IPage<IVendor>> => {
  try {
    const q = filter.q?.trim();
    const where: Prisma.OpsVendorWhereInput = {
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { gstin: { startsWith: q.toUpperCase() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.opsVendor.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: filter.offset, take: filter.limit }),
      db.opsVendor.count({ where }),
    ]);
    return { items: rows.map(toVendor), total };
  } catch (error) {
    throw error;
  }
};

const update = async (id: string, data: IVendorUpdate, db: Db = prisma): Promise<IVendor> => {
  try {
    return toVendor(await db.opsVendor.update({ where: { id }, data }));
  } catch (error) {
    throw error;
  }
};

// One conditional UPDATE: two requests flipping the same vendor cannot both win. Null
// means the vendor was not in the expected state any more.
const switchActive = async (
  id: string,
  expectedActive: boolean,
  data: { isActive: boolean; deactivatedAt: Date | null; deactivationReason: string | null; deactivatedBy: string | null },
  db: Db = prisma
): Promise<IVendor | null> => {
  try {
    const { count } = await db.opsVendor.updateMany({ where: { id, isActive: expectedActive }, data });
    return count === 0 ? null : await findById(id, db);
  } catch (error) {
    throw error;
  }
};

const createAgreement = async (data: IAgreementCreate, db: Db = prisma): Promise<IAgreement> => {
  try {
    return toAgreement(
      await db.opsVendorAgreement.create({
        data: { ...data, startDate: toDbDate(data.startDate), endDate: data.endDate ? toDbDate(data.endDate) : null },
      })
    );
  } catch (error) {
    throw error;
  }
};

const listAgreements = async (
  vendorId: string,
  offset: number,
  limit: number,
  db: Db = prisma
): Promise<IPage<IAgreement>> => {
  try {
    const where = { vendorId };
    const [rows, total] = await Promise.all([
      db.opsVendorAgreement.findMany({
        where,
        orderBy: [{ startDate: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      db.opsVendorAgreement.count({ where }),
    ]);
    return { items: rows.map(toAgreement), total };
  } catch (error) {
    throw error;
  }
};

const findAgreement = async (vendorId: string, agreementId: string, db: Db = prisma): Promise<IAgreement | null> => {
  try {
    const row = await db.opsVendorAgreement.findFirst({ where: { id: agreementId, vendorId } });
    return row ? toAgreement(row) : null;
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock, held until the transaction ends: two simultaneous
// attachments queue instead of each overwriting the other's list.
const lockAgreement = async (vendorId: string, agreementId: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.opsVendorAgreement.updateMany({
      where: { id: agreementId, vendorId },
      data: { updatedAt: new Date() },
    });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const saveAgreementDocuments = async (id: string, documents: IDocumentRef[], db: Db): Promise<IAgreement> => {
  try {
    return toAgreement(
      await db.opsVendorAgreement.update({
        where: { id },
        data: { documents: documents as unknown as Prisma.InputJsonValue },
      })
    );
  } catch (error) {
    throw error;
  }
};

export const OpsVendorQuery = {
  inTransaction,
  create,
  findById,
  findByIds,
  list,
  update,
  switchActive,
  createAgreement,
  listAgreements,
  findAgreement,
  lockAgreement,
  saveAgreementDocuments,
};
