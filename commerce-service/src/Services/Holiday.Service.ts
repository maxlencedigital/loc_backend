import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { IdentifiedRequest, RequestUser } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { HOLIDAY_TYPES, IHoliday } from "../Models/Hr/Leave.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { HolidayAudience, HolidayQuery } from "../Queries/Holiday.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { businessToday, formatDate, parseDate } from "../Utils/HrDate.js";
import { parseUuid } from "../Utils/HrInput.js";
import { optionalOneOf, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

const MAX_HOLIDAY_STORES = 100;

export const toHolidayView = (holiday: IHoliday) => ({
  id: holiday.id,
  date: formatDate(holiday.date),
  name: holiday.name,
  type: holiday.type,
  storeIds: holiday.storeIds,
});

// Everyone may see holidays, but a store-bound person sees the general ones plus their
// own store's; a rider (no store scope) sees the general ones plus their store's if known.
const audienceFor = (user: RequestUser, requested: unknown): HolidayAudience => {
  if (user.role === "driver") return isUuid(user.storeId) ? user.storeId : null;
  if (user.role === "manager" || user.role === "staff") return resolveStoreScope({ user } as IdentifiedRequest);
  const storeId = queryString(requested, "storeId");
  if (storeId === undefined) return undefined;
  return parseUuid(storeId, "storeId");
};

const list = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const yearRaw = queryString(query.year, "year");
    const year = yearRaw === undefined ? businessToday().getUTCFullYear() : wholeNumber(Number(yearRaw), "year", 2000, 2100);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));
    const { items, total } = await HolidayQuery.list(from, to, audienceFor(user, query.storeId), page.offset, page.limit);
    return toPage(items.map(toHolidayView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const type = optionalOneOf(body.type, HOLIDAY_TYPES, "type") ?? "public";
    let storeIds: string[] = [];
    if (type === "store") {
      if (!Array.isArray(body.storeIds) || body.storeIds.length === 0 || body.storeIds.length > MAX_HOLIDAY_STORES) {
        throw new CustomException("storeIds must list the stores a store holiday closes.", badRequest);
      }
      storeIds = [...new Set(body.storeIds.map((id: unknown) => parseUuid(id, "storeIds")))];
      const known = new Set((await StoreQuery.list(null)).map((store) => store.id));
      if (storeIds.some((id) => !known.has(id))) throw new CustomException("A store in storeIds does not exist.", badRequest);
    } else if (body.storeIds !== undefined && !(Array.isArray(body.storeIds) && body.storeIds.length === 0)) {
      throw new CustomException("storeIds only applies to a store holiday.", badRequest);
    }
    try {
      return toHolidayView(
        await HolidayQuery.create({ date: parseDate(body.date, "date"), name: text(body.name, "name", 80), type, storeIds })
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("That holiday is already on the calendar.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (id: string) => {
  try {
    if (!isUuid(id) || !(await HolidayQuery.remove(id))) throw new CustomException("Holiday not found.", notFound);
    return { id, removed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const HolidayService = { list, create, remove };
