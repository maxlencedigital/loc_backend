import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import {
  CUSTOMER_TYPES,
  ICustomer,
  ICustomerUpdate,
} from "../Models/Customer/Customer.Interface.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, parseBody, parseLimit, queryString, text } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";

const NOT_FOUND = "Customer not found.";
const CHOOSE_STORE = "Choose a store.";
const MAX_ADDRESSES = 10;
const MAX_TAGS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const toCustomerView = (customer: ICustomer) => ({
  id: customer.id,
  name: customer.name,
  phone: customer.phone,
  email: customer.email,
  type: customer.type,
  storeId: customer.storeId,
  joinedAt: customer.createdAt.toISOString(),
  orders: customer.orderCount,
  lifetimeValue: toRupees(customer.lifetimeValuePaise),
  // The dashboard type has no "never ordered"; the join date is the honest stand-in.
  lastOrderAt: (customer.lastOrderAt ?? customer.createdAt).toISOString(),
  churnRisk: customer.churnRisk,
  rating: customer.rating,
  addresses: customer.addresses,
  walletBalance: toRupees(customer.walletBalancePaise),
  loyaltyPoints: customer.loyaltyPoints,
  tags: customer.tags,
});

// One canonical "+91 NNNNN NNNNN" form, so the same mobile cannot be added twice
// as "98450 12345" and "+919845012345".
export const normalizePhone = (value: unknown): string => {
  const digits = (typeof value === "string" ? value : "").replace(/\D/g, "");
  const national = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.replace(/^0(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new CustomException("phone must be a valid 10-digit Indian mobile number.", badRequest);
  }
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
};

const parseEmail = (value: unknown): string => {
  const email = text(value, "email", 120).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new CustomException("email is not valid.", badRequest);
  return email;
};

const parseStringList = (value: unknown, field: string, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new CustomException(`${field} must be a list of at most ${maxItems} entries.`, badRequest);
  }
  return value.map((entry) => text(entry, field, maxLength));
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const customers = await CustomerQuery.search({
      storeId: scope,
      q: queryString(query.q, "q"),
      type: optionalOneOf(queryString(query.segment, "segment"), CUSTOMER_TYPES, "segment"),
      limit: parseLimit(query.limit),
    });
    return customers.map(toCustomerView);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const customer = await CustomerQuery.findById(id, scope);
    if (!customer) throw new CustomException(NOT_FOUND, notFound);
    return toCustomerView(customer);
  } catch (error) {
    throw toCustomException(error);
  }
};

// A store-bound caller always creates in their own store; an admin names the store with the
// scope header or, failing that, `storeId` in the body.
const resolveStoreForCreate = async (scope: StoreScope, bodyStoreId: unknown): Promise<string> => {
  const storeId = scope ?? bodyStoreId;
  if (!isUuid(storeId) || !(await StoreQuery.findById(storeId, null))) {
    throw new CustomException(CHOOSE_STORE, badRequest);
  }
  return storeId;
};

const duplicatePhone = (error: unknown) =>
  isUniqueViolation(error, "phone") ? new CustomException("A customer with this phone number already exists.", conflict) : error;

const create = async (scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      name: text(body.name, "name", 80),
      phone: normalizePhone(body.phone),
      email: body.email === undefined || body.email === "" ? "" : parseEmail(body.email),
      type: optionalOneOf(body.type, CUSTOMER_TYPES, "type") ?? "retail",
      addresses: body.addresses === undefined ? [] : parseStringList(body.addresses, "addresses", MAX_ADDRESSES, 200),
      tags: body.tags === undefined ? [] : parseStringList(body.tags, "tags", MAX_TAGS, 30),
    };
    const storeId = await resolveStoreForCreate(scope, body.storeId);
    try {
      return toCustomerView(await CustomerQuery.create({ ...data, storeId }));
    } catch (error) {
      throw duplicatePhone(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const data: ICustomerUpdate = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 80);
    if (body.phone !== undefined) data.phone = normalizePhone(body.phone);
    if (body.email !== undefined) data.email = body.email === "" ? "" : parseEmail(body.email);
    if (body.type !== undefined) data.type = oneOf(body.type, CUSTOMER_TYPES, "type");
    if (body.addresses !== undefined) data.addresses = parseStringList(body.addresses, "addresses", MAX_ADDRESSES, 200);
    if (body.tags !== undefined) data.tags = parseStringList(body.tags, "tags", MAX_TAGS, 30);

    if (!(await CustomerQuery.findById(id, scope))) throw new CustomException(NOT_FOUND, notFound);
    try {
      return toCustomerView(await CustomerQuery.update(id, data));
    } catch (error) {
      throw duplicatePhone(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CustomerService = { list, getById, create, update };
