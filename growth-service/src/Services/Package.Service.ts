import { randomUUID } from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound, tooManyRequests } from "../../commons/Utils/StatusCode.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { PackageQuery } from "../Queries/Package.Query.js";
import { FinanceClient } from "../Clients/Finance.Client.js";
import { GatewayClient } from "../Clients/Gateway.Client.js";
import type { ICustomerPackage, IPackageCreate, IPrepaidPackage } from "../Models/Package/Package.Interface.js";
import {
  bodyOf,
  boolField,
  enumField,
  intField,
  iso,
  onlyKeys,
  pathId,
  queryBool,
  queryEnum,
  queryUuid,
  stringField,
  toPaise,
  toRupees,
} from "../Utils/Input.js";
import { Limits } from "./RateLimit.Service.js";

const PATCHABLE = ["name", "price", "credit", "validityDays", "description", "isActive"] as const;
const PAYMENT_METHODS = ["online", "saved_method"] as const;
const PACKAGE_STATUSES = ["active", "exhausted", "expired"] as const;
const PENDING_WINDOW_MS = 24 * 60 * 60_000;
export const PACKAGE_ORDER_PREFIX = "PKG-";

const toApi = (p: IPrepaidPackage) => ({
  id: p.id,
  name: p.name,
  price: toRupees(p.pricePaise),
  credit: toRupees(p.creditPaise),
  validityDays: p.validityDays,
  description: p.description,
  isActive: p.isActive,
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
});

const toCustomerApi = (p: IPrepaidPackage) => ({
  id: p.id,
  name: p.name,
  price: toRupees(p.pricePaise),
  credit: toRupees(p.creditPaise),
  validityDays: p.validityDays,
  description: p.description,
});

// An active package past its expiry reads as expired without waiting for a job.
export const effectiveStatus = (p: ICustomerPackage, now: Date): string =>
  p.status === "active" && p.expiresAt !== null && p.expiresAt <= now ? "expired" : p.status;

const toOwnedApi = (p: ICustomerPackage) => ({
  id: p.id,
  packageId: p.packageId,
  name: p.packageName,
  remainingCredit: toRupees(p.remainingCreditPaise),
  expiresOn: iso(p.expiresAt),
});

const toAdminApi = (p: ICustomerPackage, now: Date) => ({
  id: p.id,
  customerId: p.customerId,
  packageId: p.packageId,
  name: p.packageName,
  price: toRupees(p.pricePaise),
  credit: toRupees(p.creditPaise),
  remainingCredit: toRupees(p.remainingCreditPaise),
  status: effectiveStatus(p, now),
  orderRef: p.orderRef,
  expiresOn: iso(p.expiresAt),
  activatedAt: iso(p.activatedAt),
  createdAt: iso(p.createdAt),
});

const buildPackage = (input: Record<string, unknown>, base: IPackageCreate | null): IPackageCreate => {
  onlyKeys(input, PATCHABLE);
  const next: IPackageCreate = base ?? { name: "", pricePaise: 0, creditPaise: 0, validityDays: 1, description: null, isActive: true };
  if (input.name !== undefined) next.name = stringField(input.name, "name", 1, 120);
  if (input.price !== undefined) next.pricePaise = toPaise(input.price, "price", false);
  if (input.credit !== undefined) next.creditPaise = toPaise(input.credit, "credit", false);
  if (input.validityDays !== undefined) next.validityDays = intField(input.validityDays, "validityDays", 1, 3650);
  if (input.description !== undefined) {
    next.description = input.description === null ? null : stringField(input.description, "description", 0, 500) || null;
  }
  if (input.isActive !== undefined) next.isActive = boolField(input.isActive, "isActive");
  return next;
};

// ------------------------------------------------------------------ admin

const listPackages = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await PackageQuery.listPackages({ isActive: queryBool(query.isActive, "isActive") }, page);
    return toPage(items.map(toApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createPackage = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["name", "price", "credit", "validityDays"]);
    return toApi(await PackageQuery.createPackage(buildPackage(input, null)));
  } catch (error) {
    throw toCustomException(error);
  }
};

const findOrThrow = async (id: string): Promise<IPrepaidPackage> => {
  const found = await PackageQuery.findPackage(id);
  if (!found) throw new CustomException("Package not found.", notFound);
  return found;
};

const getPackage = async (id: unknown) => {
  try {
    return toApi(await findOrThrow(pathId(id)));
  } catch (error) {
    throw toCustomException(error);
  }
};

const updatePackage = async (id: unknown, body: unknown) => {
  try {
    const packageId = pathId(id);
    const input = bodyOf(body);
    const current = await findOrThrow(packageId);
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = current;
    const updated = await PackageQuery.updatePackage(packageId, buildPackage(input, base));
    if (!updated) throw new CustomException("Package not found.", notFound);
    return toApi(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listCustomerPackages = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const now = new Date();
    const { items, total } = await PackageQuery.listCustomerPackages(
      {
        customerId: queryUuid(query.customerId, "customerId"),
        status: queryEnum(query.status, "status", PACKAGE_STATUSES),
        now,
      },
      page
    );
    return toPage(items.map((p) => toAdminApi(p, now)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getCustomerPackage = async (id: unknown) => {
  try {
    const found = await PackageQuery.findCustomerPackage(pathId(id));
    if (!found || found.status === "pending") throw new CustomException("Customer package not found.", notFound);
    return toAdminApi(found, new Date());
  } catch (error) {
    throw toCustomException(error);
  }
};

const listSubscribers = async (id: unknown, query: Record<string, unknown>) => {
  try {
    const packageId = pathId(id);
    await findOrThrow(packageId);
    const page = parsePage(query);
    const now = new Date();
    const { items, total } = await PackageQuery.listCustomerPackages({ packageId, now }, page);
    // Names live in the gateway; if it is unreachable the list still works, without names.
    let names = new Map<string, string | null>();
    try {
      const users = await GatewayClient.lookupUsers([...new Set(items.map((i) => i.customerId))]);
      names = new Map(users.map((u) => [u.id, u.name]));
    } catch {
      names = new Map();
    }
    return toPage(
      items.map((p) => ({
        customerId: p.customerId,
        name: names.get(p.customerId) ?? null,
        remainingCredit: toRupees(p.remainingCreditPaise),
        expiresOn: iso(p.expiresAt),
      })),
      total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- customer

const listAvailable = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await PackageQuery.listPackages({ isActive: true }, page);
    return toPage(items.map(toCustomerApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listOwned = async (customerId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await PackageQuery.listCustomerPackages({ customerId, now: new Date() }, page);
    return toPage(items.map(toOwnedApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const purchase = async (customerId: string, id: unknown, body: unknown) => {
  try {
    const packageId = pathId(id);
    const input = body === undefined || body === null ? {} : bodyOf(body);
    if (input.paymentMethod !== undefined) enumField(input.paymentMethod, "paymentMethod", PAYMENT_METHODS);

    const pkg = await PackageQuery.findPackage(packageId);
    if (!pkg || !pkg.isActive) throw new CustomException("Package not found.", notFound);

    // Bound on abandoned checkouts, so purchase attempts cannot pile up rows.
    const pending = await PackageQuery.countPending(customerId, new Date(Date.now() - PENDING_WINDOW_MS));
    if (pending >= Limits.packagePurchasePending) {
      throw new CustomException("You have too many unfinished purchases. Please complete or wait for them to expire.", tooManyRequests);
    }

    // The price is the server's, never the client's. Finance is called first so a refusal leaves
    // no row behind; a finance order with no row is harmless.
    const purchaseId = randomUUID();
    const orderRef = `${PACKAGE_ORDER_PREFIX}${purchaseId}`;
    const checkout = await FinanceClient.createPaymentOrder({
      orderRef,
      amountPaise: pkg.pricePaise,
      customerUserId: customerId,
      idempotencyKey: orderRef,
    });
    await PackageQuery.createCustomerPackage({
      id: purchaseId,
      customerId,
      packageId: pkg.id,
      packageName: pkg.name,
      pricePaise: pkg.pricePaise,
      creditPaise: pkg.creditPaise,
      validityDays: pkg.validityDays,
      orderRef,
    });
    return {
      customerPackageId: purchaseId,
      orderRef,
      paymentId: checkout.paymentId,
      razorpayOrderId: checkout.razorpayOrderId,
      amount: toRupees(checkout.amountPaise),
      currency: checkout.currency,
      keyId: checkout.keyId,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- internal

/** Called once the package's finance order is paid. Idempotent: a second call changes nothing. */
const activate = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["orderRef"]);
    const orderRef = stringField(input.orderRef, "orderRef", 5, 100);
    if (!orderRef.startsWith(PACKAGE_ORDER_PREFIX)) throw new CustomException("orderRef is not a package purchase.", badRequest);

    const row = await PackageQuery.findCustomerPackageByRef(orderRef);
    if (!row) throw new CustomException("Package purchase not found.", notFound);
    if (row.status !== "pending") return { ...toAdminApi(row, new Date()), replayed: true };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + row.validityDays * 24 * 60 * 60_000);
    await PackageQuery.activate(orderRef, expiresAt, now);
    // Whether this call or a concurrent one flipped it, the stored row is the answer.
    const after = await PackageQuery.findCustomerPackageByRef(orderRef);
    return { ...toAdminApi(after as ICustomerPackage, now), replayed: false };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PackageService = {
  listPackages, createPackage, getPackage, updatePackage,
  listCustomerPackages, getCustomerPackage, listSubscribers,
  listAvailable, listOwned, purchase, activate,
};
