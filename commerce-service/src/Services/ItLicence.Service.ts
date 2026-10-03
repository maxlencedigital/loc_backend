import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ILicence, ILicenceUpdate } from "../Models/It/It.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { ItLicenceQuery } from "../Queries/ItLicence.Query.js";
import { businessToday, dateOut, parseDate } from "../Utils/AssetDates.js";
import { actorId, actorName, amountToPaise, patchAmount, patchDate, patchText, requireChange, uuidField } from "../Utils/AssetInput.js";
import { optionalText, parseBody, text, wholeNumber } from "../Utils/Input.js";
import { toRupees } from "../Utils/Money.js";
import { isUuid } from "../Utils/Uuid.js";

const NOT_FOUND = "Licence not found.";
const MAX_SEATS = 100_000;
const HOLDERS_LIMIT = 200;
const HISTORY_LIMIT = 50;

export const toLicenceView = (l: ILicence) => ({
  id: l.id,
  software: l.software,
  vendor: l.vendor,
  seats: l.seats,
  seatsUsed: l.seatsUsed,
  seatsAvailable: l.seats - l.seatsUsed,
  validUntil: dateOut(l.validUntil),
  cost: l.costPaise === null ? null : toRupees(l.costPaise),
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
});

const list = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const result = await ItLicenceQuery.search(page);
    return toPage(result.items.map(toLicenceView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Who holds a seat is capped at 200 names; seatsUsed always carries the full count.
const getById = async (id: string) => {
  try {
    const licence = isUuid(id) ? await ItLicenceQuery.findById(id) : null;
    if (!licence) throw new CustomException(NOT_FOUND, notFound);
    const [holders, events] = await Promise.all([
      ItLicenceQuery.listHolders(id, HOLDERS_LIMIT),
      ItLicenceQuery.listEvents(id, HISTORY_LIMIT),
    ]);
    return {
      ...toLicenceView(licence),
      holders: holders.map((h) => ({ employeeId: h.employeeId, assignedAt: h.assignedAt.toISOString() })),
      history: events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, employeeId: e.employeeId, by: e.byName })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (input: unknown) => {
  try {
    const body = parseBody(input);
    return toLicenceView(
      await ItLicenceQuery.create({
        software: text(body.software, "software", 120),
        vendor: optionalText(body.vendor, "vendor", 120) ?? null,
        seats: wholeNumber(body.seats, "seats", 1, MAX_SEATS),
        validUntil: body.validUntil === undefined || body.validUntil === null ? null : parseDate(body.validUntil, "validUntil"),
        costPaise: body.cost === undefined || body.cost === null ? null : amountToPaise(body.cost, "cost"),
      })
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, input: unknown) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const body = parseBody(input);
    const data: ILicenceUpdate = {};
    if (body.software !== undefined) data.software = text(body.software, "software", 120);
    const vendor = patchText(body.vendor, "vendor", 120);
    if (vendor !== undefined) data.vendor = vendor;
    if (body.seats !== undefined) data.seats = wholeNumber(body.seats, "seats", 1, MAX_SEATS);
    const validUntil = patchDate(body.validUntil, "validUntil");
    if (validUntil !== undefined) data.validUntil = validUntil;
    const cost = patchAmount(body.cost, "cost");
    if (cost !== undefined) data.costPaise = cost;
    requireChange(data);

    const updated = await ItLicenceQuery.inTransaction(async (tx) => {
      const licence = await ItLicenceQuery.lockById(id, tx);
      if (!licence) throw new CustomException(NOT_FOUND, notFound);
      if (data.seats !== undefined && data.seats < licence.seatsUsed) {
        throw new CustomException(`${licence.seatsUsed} seats are in use; revoke some before lowering the total to ${data.seats}.`, conflict);
      }
      return await ItLicenceQuery.update(id, data, tx);
    });
    return toLicenceView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Soft delete: the grant history stays. A licence still in use must be emptied first.
const remove = async (id: string) => {
  try {
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    await ItLicenceQuery.inTransaction(async (tx) => {
      const licence = await ItLicenceQuery.lockById(id, tx);
      if (!licence) throw new CustomException(NOT_FOUND, notFound);
      if (licence.seatsUsed > 0) {
        throw new CustomException(`${licence.seatsUsed} seats are still in use; revoke them before deleting this licence.`, conflict);
      }
      await ItLicenceQuery.softDelete(id, tx);
    });
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

// Everything after the lock is read-check-write on one licence: the last seat can be given once.
const assign = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const employeeId = uuidField(parseBody(input).employeeId, "employeeId");
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const updated = await ItLicenceQuery.inTransaction(async (tx) => {
      const licence = await ItLicenceQuery.lockById(id, tx);
      if (!licence) throw new CustomException(NOT_FOUND, notFound);
      if (licence.validUntil && licence.validUntil < businessToday()) {
        throw new CustomException("This licence has expired.", conflict);
      }
      if (await ItLicenceQuery.hasSeat(id, employeeId, tx)) {
        throw new CustomException("This person already has a seat on this licence.", conflict);
      }
      if (licence.seatsUsed >= licence.seats) throw new CustomException("No seats left on this licence.", conflict);
      return await ItLicenceQuery.addSeat(id, employeeId, { kind: "assigned", employeeId, byUserId: actorId(user), byName: actorName(user) }, tx);
    });
    return toLicenceView(updated);
  } catch (error) {
    if (isUniqueViolation(error)) throw new CustomException("This person already has a seat on this licence.", conflict);
    throw toCustomException(error);
  }
};

const revoke = async (id: string, user: RequestUser, input: unknown) => {
  try {
    const employeeId = uuidField(parseBody(input).employeeId, "employeeId");
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const updated = await ItLicenceQuery.inTransaction(async (tx) => {
      if (!(await ItLicenceQuery.lockById(id, tx))) throw new CustomException(NOT_FOUND, notFound);
      const result = await ItLicenceQuery.removeSeat(id, employeeId, { kind: "revoked", employeeId, byUserId: actorId(user), byName: actorName(user) }, tx);
      if (!result) throw new CustomException("That person does not hold a seat on this licence.", notFound);
      return result;
    });
    return toLicenceView(updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const ItLicenceService = { list, getById, create, update, remove, assign, revoke };
