import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { IStore, IStoreUpdate, STORE_STATUSES, STORE_TYPES } from "../Models/Store/Store.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { StoreScope } from "../Middleware/StoreScope.js";
import { oneOf, optionalOneOf, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

const MAX_CAPACITY_KG_PER_DAY = 100_000;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,15}$/;

const NOT_FOUND = "Store not found.";

export const toStoreView = (store: IStore) => ({
  id: store.id,
  code: store.code,
  name: store.name,
  city: store.city,
  address: store.address,
  status: store.status,
  type: store.type,
  openingHours: store.openingHours,
  capacityKgPerDay: store.capacityKgPerDay,
});

const parseCode = (value: unknown): string => {
  const code = text(value, "code", 16).toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new CustomException("code must be 2 to 16 letters, digits or dashes, e.g. BLR-IND.", badRequest);
  }
  return code;
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const status = optionalOneOf(queryString(query.status, "status"), STORE_STATUSES, "status");
    return (await StoreQuery.list(scope, status)).map(toStoreView);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getById = async (id: string, scope: StoreScope) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const store = await StoreQuery.findById(id, scope);
    if (!store) throw new CustomException(NOT_FOUND, notFound);
    return toStoreView(store);
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      code: parseCode(body.code),
      name: text(body.name, "name", 80),
      city: text(body.city, "city", 60),
      address: text(body.address, "address", 200),
      type: oneOf(body.type, STORE_TYPES, "type"),
      openingHours: text(body.openingHours, "openingHours", 40),
      capacityKgPerDay: wholeNumber(body.capacityKgPerDay, "capacityKgPerDay", 0, MAX_CAPACITY_KG_PER_DAY),
      status: optionalOneOf(body.status, STORE_STATUSES, "status") ?? "live",
    };
    try {
      return toStoreView(await StoreQuery.create(data));
    } catch (error) {
      if (isUniqueViolation(error, "code")) {
        throw new CustomException("A store with this code already exists.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const data: IStoreUpdate = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 80);
    if (body.city !== undefined) data.city = text(body.city, "city", 60);
    if (body.address !== undefined) data.address = text(body.address, "address", 200);
    if (body.type !== undefined) data.type = oneOf(body.type, STORE_TYPES, "type");
    if (body.openingHours !== undefined) data.openingHours = text(body.openingHours, "openingHours", 40);
    if (body.status !== undefined) data.status = oneOf(body.status, STORE_STATUSES, "status");
    if (body.capacityKgPerDay !== undefined) {
      data.capacityKgPerDay = wholeNumber(body.capacityKgPerDay, "capacityKgPerDay", 0, MAX_CAPACITY_KG_PER_DAY);
    }
    if (body.code !== undefined) throw new CustomException("A store code cannot be changed.", badRequest);

    if (!(await StoreQuery.findById(id, null))) throw new CustomException(NOT_FOUND, notFound);
    return toStoreView(await StoreQuery.update(id, data));
  } catch (error) {
    throw toCustomException(error);
  }
};

const deactivate = async (id: string) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    if (!(await StoreQuery.findById(id, null))) throw new CustomException(NOT_FOUND, notFound);
    return toStoreView(await StoreQuery.update(id, { status: "closed" }));
  } catch (error) {
    throw toCustomException(error);
  }
};

export const StoreService = { list, getById, create, update, deactivate };
