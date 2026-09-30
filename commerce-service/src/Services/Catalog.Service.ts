import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { CUSTOMER_TYPES } from "../Models/Customer/Customer.Interface.js";
import { IPriceList, IPriceListUpdate, IPriceRow, IService } from "../Models/Catalog/Catalog.Interface.js";
import { CatalogQuery } from "../Queries/Catalog.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { optionalOneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { rupeesToPaise, toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";

// ₹1,00,000 for one unit is far past any laundry rate; it only stops a typo.
const MAX_RATE_PAISE = 10_000_000;

const LIST_NOT_FOUND = "Price list not found.";
const ROW_NOT_FOUND = "Price row not found.";
const DUPLICATE_NAME = "A price list with this name already exists.";

export const toServiceView = (service: IService) => ({
  id: service.id,
  name: service.name,
  department: service.department,
  unit: service.unit,
  turnaroundHours: service.turnaroundHours,
  expressAvailable: service.expressAvailable,
  active: service.active,
});

const toPriceListView = (list: IPriceList) => ({
  id: list.id,
  name: list.name,
  appliesTo: list.appliesTo,
  active: list.active,
  updatedAt: list.updatedAt.toISOString(),
  rows: list.rowCount,
});

const toPriceRowView = (row: IPriceRow) => ({
  id: row.id,
  priceListId: row.priceListId,
  serviceName: row.serviceName,
  garment: row.garment,
  category: row.category,
  unit: row.unit,
  rate: toRupees(row.ratePaise),
  expressRate: toRupees(row.expressRatePaise),
});

const duplicateName = (error: unknown) =>
  isUniqueViolation(error, "name") ? new CustomException(DUPLICATE_NAME, conflict) : error;

const requireList = async (id: string): Promise<IPriceList> => {
  const list = isUuid(id) ? await CatalogQuery.findListById(id) : null;
  if (!list) throw new CustomException(LIST_NOT_FOUND, notFound);
  return list;
};

const listServices = async () => {
  try {
    return (await CatalogQuery.listServices()).map(toServiceView);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listPriceLists = async () => {
  try {
    return (await CatalogQuery.listLists()).map(toPriceListView);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listRows = async (id: string) => {
  try {
    await requireList(id);
    return (await CatalogQuery.listRows(id)).map(toPriceRowView);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createList = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const storeId = body.storeId === undefined || body.storeId === null ? null : body.storeId;
    if (storeId !== null && (!isUuid(storeId) || !(await StoreQuery.findById(storeId, null)))) {
      throw new CustomException("storeId does not match a store.", badRequest);
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      throw new CustomException("active must be true or false.", badRequest);
    }
    const data = {
      name: text(body.name, "name", 80),
      appliesTo: optionalText(body.appliesTo, "appliesTo", 120) ?? "",
      active: body.active ?? true,
      storeId,
      customerType: optionalOneOf(body.customerType, CUSTOMER_TYPES, "customerType") ?? null,
    };
    try {
      return toPriceListView(await CatalogQuery.createList(data));
    } catch (error) {
      throw duplicateName(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateList = async (id: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const data: IPriceListUpdate = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 80);
    if (body.appliesTo !== undefined) data.appliesTo = text(body.appliesTo, "appliesTo", 120);
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") throw new CustomException("active must be true or false.", badRequest);
      data.active = body.active;
    }
    await requireList(id);
    try {
      await CatalogQuery.updateList(id, data);
    } catch (error) {
      throw duplicateName(error);
    }
    return toPriceListView(await requireList(id));
  } catch (error) {
    throw toCustomException(error);
  }
};

// "Name (copy)", then "Name (copy 2)": the first free name, since names are unique.
const copyName = async (name: string): Promise<string> => {
  const taken = new Set(await CatalogQuery.listNamesStartingWith(`${name} (copy`));
  let candidate = `${name} (copy)`;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${name} (copy ${n})`;
  return candidate;
};

const duplicateList = async (id: string) => {
  try {
    const source = await requireList(id);
    const name = await copyName(source.name);
    try {
      const copy = await CatalogQuery.inTransaction(async (tx) => {
        // The copy starts inactive so it cannot change live pricing until someone turns it on.
        const created = await CatalogQuery.createList(
          {
            name,
            appliesTo: source.appliesTo,
            active: false,
            storeId: source.storeId,
            customerType: source.customerType,
          },
          tx
        );
        await CatalogQuery.copyRows(source.id, created.id, tx);
        return await CatalogQuery.findListById(created.id, tx);
      });
      return toPriceListView(copy as IPriceList);
    } catch (error) {
      throw duplicateName(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateRow = async (listId: string, rowId: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const ratePaise = rupeesToPaise(body.rate, "rate", MAX_RATE_PAISE);
    const requestedExpress =
      body.expressRate === undefined ? undefined : rupeesToPaise(body.expressRate, "expressRate", MAX_RATE_PAISE);
    await requireList(listId);

    return await CatalogQuery.inTransaction(async (tx) => {
      const current = isUuid(rowId) ? await CatalogQuery.findRow(listId, rowId, tx) : null;
      if (!current) throw new CustomException(ROW_NOT_FOUND, notFound);
      const expressRatePaise = requestedExpress ?? current.expressRatePaise;
      if (expressRatePaise < ratePaise) {
        throw new CustomException("expressRate cannot be lower than rate.", badRequest);
      }
      await CatalogQuery.updateRowRates(listId, rowId, { ratePaise, expressRatePaise }, tx);
      return toPriceRowView((await CatalogQuery.findRow(listId, rowId, tx)) as IPriceRow);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CatalogService = {
  listServices,
  listPriceLists,
  listRows,
  createList,
  updateList,
  duplicateList,
  updateRow,
};
