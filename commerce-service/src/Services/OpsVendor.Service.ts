import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import {
  IAgreement,
  IMaterial,
  IMaterialUpdate,
  IVendor,
  IVendorUpdate,
  IVendorWrite,
  MATERIAL_CATEGORIES,
  VENDOR_CATEGORIES,
} from "../Models/OpsVendors/Vendor.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { OpsMaterialQuery } from "../Queries/OpsMaterial.Query.js";
import { OpsPurchaseOrderQuery } from "../Queries/OpsPurchaseOrder.Query.js";
import { OpsVendorQuery } from "../Queries/OpsVendor.Query.js";
import { optionalOneOf, oneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { optionalDateInput, parseDateInput, todayIst } from "../Utils/OpsDates.js";
import {
  milliToQuantity,
  nonNegativeQuantityToMilli,
  nullableText,
  parseDocumentRef,
  queryBoolean,
} from "../Utils/OpsInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorOf, isBackOffice, notFoundError, parseRange } from "./OpsActor.js";

const VENDOR_NOT_FOUND = "Vendor";
const MAX_DOCUMENTS = 10;
const MAX_REORDER_MILLI = 1_000_000_000;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER = /^\d{6,20}$/;

// ------------------------------------------------------------------ vendors
export const toVendorView = (vendor: IVendor, user: RequestUser) => ({
  id: vendor.id,
  name: vendor.name,
  category: vendor.category,
  contactName: vendor.contactName,
  phone: vendor.phone,
  email: vendor.email,
  address: vendor.address,
  gstin: vendor.gstin,
  paymentTerms: vendor.paymentTerms,
  isActive: vendor.isActive,
  deactivatedAt: vendor.deactivatedAt?.toISOString() ?? null,
  deactivationReason: vendor.deactivationReason,
  // Never the number itself: only its last four digits are stored.
  ...(isBackOffice(user) ? { bankAccountMasked: vendor.bankAccountLast4 ? `XXXXXX${vendor.bankAccountLast4}` : null, bankIfsc: vendor.bankIfsc } : {}),
  createdAt: vendor.createdAt.toISOString(),
  updatedAt: vendor.updatedAt.toISOString(),
});

const pattern = (value: unknown, field: string, regex: RegExp, hint: string, upper = false): string | null | undefined => {
  const raw = nullableText(value, field, 40);
  if (raw === undefined || raw === null) return raw;
  const normal = upper ? raw.toUpperCase() : raw;
  if (!regex.test(normal)) throw new CustomException(`${field} must be ${hint}.`, badRequest);
  return normal;
};

// Reads the vendor fields a caller may set. `undefined` = not sent (leave as is).
const parseVendorFields = (body: Record<string, unknown>): Partial<IVendorWrite> & { isActive?: boolean } => {
  const fields: Partial<IVendorWrite> & { isActive?: boolean } = {};
  if (body.name !== undefined) fields.name = text(body.name, "name", 120);
  if (body.category !== undefined) fields.category = oneOf(body.category, VENDOR_CATEGORIES, "category");
  const contactName = nullableText(body.contactName, "contactName", 120);
  if (contactName !== undefined) fields.contactName = contactName;
  const phone = pattern(body.phone, "phone", E164, "an E.164 number like +919876543210");
  if (phone !== undefined) fields.phone = phone;
  const email = nullableText(body.email, "email", 254);
  if (email !== undefined) {
    if (email !== null && !EMAIL.test(email)) throw new CustomException("email must be a valid email address.", badRequest);
    fields.email = email;
  }
  const address = nullableText(body.address, "address", 300);
  if (address !== undefined) fields.address = address;
  const gstin = pattern(body.gstin, "gstin", GSTIN, "a valid 15-character GSTIN", true);
  if (gstin !== undefined) fields.gstin = gstin;
  const terms = nullableText(body.paymentTerms, "paymentTerms", 200);
  if (terms !== undefined) fields.paymentTerms = terms;
  // Write-only: the number is reduced to its last four digits and discarded.
  const account = pattern(body.bankAccountNumber, "bankAccountNumber", ACCOUNT_NUMBER, "6 to 20 digits");
  if (account !== undefined) fields.bankAccountLast4 = account === null ? null : account.slice(-4);
  const ifsc = pattern(body.bankIfsc, "bankIfsc", IFSC, "a valid IFSC code", true);
  if (ifsc !== undefined) fields.bankIfsc = ifsc;
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new CustomException("isActive must be true or false.", badRequest);
    fields.isActive = body.isActive;
  }
  return fields;
};

const duplicateGstin = (error: unknown) => {
  if (isUniqueViolation(error, "gstin")) throw new CustomException("A vendor with this GSTIN already exists.", conflict);
};

const requireVendor = async (id: string): Promise<IVendor> => {
  const vendor = isUuid(id) ? await OpsVendorQuery.findById(id) : null;
  if (!vendor) throw notFoundError(VENDOR_NOT_FOUND);
  return vendor;
};

const listVendors = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await OpsVendorQuery.list({
      category: optionalOneOf(queryString(query.category, "category"), VENDOR_CATEGORIES, "category"),
      isActive: queryBoolean(queryString(query.isActive, "isActive"), "isActive"),
      q: queryString(query.q, "q"),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map((v) => toVendorView(v, user)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getVendor = async (id: string, user: RequestUser) => {
  try {
    return toVendorView(await requireVendor(id), user);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createVendor = async (user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const fields = parseVendorFields(body);
    if (fields.name === undefined) throw new CustomException("name is required.", badRequest);
    const now = new Date();
    const inactive = fields.isActive === false;
    try {
      const vendor = await OpsVendorQuery.create({
        name: fields.name,
        category: fields.category ?? "other",
        contactName: fields.contactName ?? null,
        phone: fields.phone ?? null,
        email: fields.email ?? null,
        address: fields.address ?? null,
        gstin: fields.gstin ?? null,
        paymentTerms: fields.paymentTerms ?? null,
        bankAccountLast4: fields.bankAccountLast4 ?? null,
        bankIfsc: fields.bankIfsc ?? null,
        createdBy: user.id,
      });
      return toVendorView(inactive ? await deactivateRow(vendor.id, null, user, now) : vendor, user);
    } catch (error) {
      duplicateGstin(error);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivateRow = async (id: string, reason: string | null, user: RequestUser, now: Date): Promise<IVendor> => {
  const vendor = await OpsVendorQuery.switchActive(
    id,
    true,
    { isActive: false, deactivatedAt: now, deactivationReason: reason, deactivatedBy: user.id }
  );
  if (!vendor) throw new CustomException("This vendor is already deactivated.", conflict);
  return vendor;
};

const updateVendor = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const { isActive, ...fields } = parseVendorFields(parseBody(input));
    let vendor = await requireVendor(id);
    if (Object.keys(fields).length > 0) {
      try {
        vendor = await OpsVendorQuery.update(id, fields as IVendorUpdate);
      } catch (error) {
        duplicateGstin(error);
        throw error;
      }
    }
    if (isActive === false && vendor.isActive) vendor = await deactivateRow(id, null, user, new Date());
    if (isActive === true && !vendor.isActive) {
      vendor =
        (await OpsVendorQuery.switchActive(id, false, { isActive: true, deactivatedAt: null, deactivationReason: null, deactivatedBy: null })) ??
        vendor;
    }
    return toVendorView(vendor, user);
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivateVendor = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const reason = nullableText(parseBody(input).reason, "reason", 500) ?? null;
    await requireVendor(id);
    return toVendorView(await deactivateRow(id, reason, user, new Date()), user);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- agreements
export const toAgreementView = (agreement: IAgreement, today: string) => ({
  id: agreement.id,
  vendorId: agreement.vendorId,
  title: agreement.title,
  startDate: agreement.startDate,
  endDate: agreement.endDate,
  terms: agreement.terms,
  // Worked out from the dates, so it is right whenever it is read.
  status: agreement.startDate > today ? "scheduled" : agreement.endDate && agreement.endDate < today ? "expired" : "active",
  documentUrl: agreement.documents.length > 0 ? agreement.documents[agreement.documents.length - 1].url : null,
  documents: agreement.documents,
  createdAt: agreement.createdAt.toISOString(),
});

const createAgreement = async (vendorId: string, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const title = text(body.title, "title", 200);
    const startDate = parseDateInput(body.startDate, "startDate");
    const endDate = optionalDateInput(body.endDate, "endDate") ?? null;
    if (endDate && endDate < startDate) throw new CustomException("endDate must not be before startDate.", badRequest);
    const terms = nullableText(body.terms, "terms", 5000) ?? null;
    const vendor = await requireVendor(vendorId);
    if (!vendor.isActive) throw new CustomException("This vendor is deactivated.", conflict);
    const agreement = await OpsVendorQuery.createAgreement({ vendorId, title, startDate, endDate, terms, createdBy: user.id });
    return toAgreementView(agreement, todayIst());
  } catch (error) {
    throw toCustomException(error);
  }
};

const listAgreements = async (vendorId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    await requireVendor(vendorId);
    const { items, total } = await OpsVendorQuery.listAgreements(vendorId, page.offset, page.limit);
    const today = todayIst();
    return toPage(items.map((a) => toAgreementView(a, today)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const attachAgreementDocument = async (vendorId: string, agreementId: string, user: RequestUser, input: unknown) => {
  try {
    const actor = actorOf(user);
    const document = parseDocumentRef(parseBody(input), actor.id, new Date());
    if (!isUuid(vendorId) || !isUuid(agreementId)) throw notFoundError("Agreement");
    const saved = await OpsVendorQuery.inTransaction(async (tx) => {
      if (!(await OpsVendorQuery.lockAgreement(vendorId, agreementId, tx))) throw notFoundError("Agreement");
      const agreement = await OpsVendorQuery.findAgreement(vendorId, agreementId, tx);
      if (!agreement) throw notFoundError("Agreement");
      if (agreement.documents.length >= MAX_DOCUMENTS) {
        throw new CustomException(`An agreement holds at most ${MAX_DOCUMENTS} documents.`, conflict);
      }
      return await OpsVendorQuery.saveAgreementDocuments(agreementId, [...agreement.documents, document], tx);
    });
    return toAgreementView(saved, todayIst());
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- history
const MS_PER_PCT = 100;

// Orders sent in the period, how many of the delivered ones met their date, spend, and what
// is still owed. A store-bound caller sees only their own store's orders.
const getVendorHistory = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const range = parseRange(query);
    await requireVendor(id);
    const history = await OpsPurchaseOrderQuery.vendorHistory(id, scope, range);
    const judged = history.deliveredOnTime + history.deliveredLate;
    return {
      orders: history.orders,
      onTimeDeliveryPct: judged === 0 ? null : Math.round((history.deliveredOnTime / judged) * MS_PER_PCT * 10) / 10,
      totalSpend: toRupees(history.totalSpendPaise),
      outstanding: toRupees(history.outstandingPaise),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- materials
export const toMaterialView = (material: IMaterial) => ({
  id: material.id,
  name: material.name,
  category: material.category,
  unit: material.unit,
  reorderLevel: milliToQuantity(material.reorderLevelMilli),
  preferredVendorId: material.preferredVendorId,
  createdAt: material.createdAt.toISOString(),
  updatedAt: material.updatedAt.toISOString(),
});

const parseMaterialFields = (body: Record<string, unknown>): IMaterialUpdate => {
  const fields: IMaterialUpdate = {};
  if (body.name !== undefined) fields.name = text(body.name, "name", 120);
  if (body.category !== undefined) fields.category = oneOf(body.category, MATERIAL_CATEGORIES, "category");
  if (body.unit !== undefined) fields.unit = text(body.unit, "unit", 20);
  if (body.reorderLevel !== undefined) {
    fields.reorderLevelMilli = nonNegativeQuantityToMilli(body.reorderLevel, "reorderLevel", MAX_REORDER_MILLI);
  }
  if (body.preferredVendorId !== undefined) {
    fields.preferredVendorId = body.preferredVendorId === null ? null : text(body.preferredVendorId, "preferredVendorId", 40);
    if (fields.preferredVendorId !== null && !isUuid(fields.preferredVendorId)) {
      throw new CustomException("preferredVendorId must be a valid id.", badRequest);
    }
  }
  return fields;
};

const checkPreferredVendor = async (vendorId: string | null | undefined) => {
  if (vendorId && !(await OpsVendorQuery.findById(vendorId))) {
    throw new CustomException("preferredVendorId does not match a vendor.", badRequest);
  }
};

const duplicateMaterial = (error: unknown) => {
  if (isUniqueViolation(error, "name")) throw new CustomException("A material with this name already exists.", conflict);
};

const listMaterials = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await OpsMaterialQuery.list(page.offset, page.limit);
    return toPage(items.map(toMaterialView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMaterial = async (id: string) => {
  try {
    const material = isUuid(id) ? await OpsMaterialQuery.findById(id) : null;
    if (!material) throw notFoundError("Material");
    return toMaterialView(material);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createMaterial = async (input: unknown) => {
  try {
    const fields = parseMaterialFields(parseBody(input));
    if (fields.name === undefined || fields.unit === undefined) throw new CustomException("name, unit are required.", badRequest);
    await checkPreferredVendor(fields.preferredVendorId);
    try {
      return toMaterialView(
        await OpsMaterialQuery.create({
          name: fields.name,
          unit: fields.unit,
          category: fields.category ?? "other",
          reorderLevelMilli: fields.reorderLevelMilli ?? 0,
          preferredVendorId: fields.preferredVendorId ?? null,
        })
      );
    } catch (error) {
      duplicateMaterial(error);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateMaterial = async (id: string, input: unknown) => {
  try {
    const fields = parseMaterialFields(parseBody(input));
    if (!isUuid(id) || !(await OpsMaterialQuery.findById(id))) throw notFoundError("Material");
    await checkPreferredVendor(fields.preferredVendorId);
    try {
      return toMaterialView(await OpsMaterialQuery.update(id, fields));
    } catch (error) {
      duplicateMaterial(error);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OpsVendorService = {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  deactivateVendor,
  createAgreement,
  listAgreements,
  attachAgreementDocument,
  getVendorHistory,
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
};
