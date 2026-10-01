import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { IEmployeeRef } from "../Models/Hr/Employee.Interface.js";
import { IHrRequest, REQUEST_CATEGORIES, REQUEST_STATUSES } from "../Models/Hr/Grievance.Interface.js";
import { GrievanceQuery } from "../Queries/Grievance.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { clock } from "../Utils/HrDate.js";
import { nullableText } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, parseBody, queryString, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { assertEmployeeInScope } from "./EmployeeAccess.js";
import { actorName } from "./HrActor.js";
import { directoryOf, employeeIdsInScope } from "./PeopleScope.js";

const NOT_FOUND = "HR request not found.";

const toView = (r: IHrRequest, name?: string) => ({
  id: r.id,
  employeeId: r.employeeId,
  ...(name !== undefined ? { employeeName: name } : {}),
  category: r.category,
  message: r.message,
  status: r.status,
  response: r.response,
  respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
  respondedBy: r.respondedByName,
  closedAt: r.closedAt ? r.closedAt.toISOString() : null,
  closeNote: r.closeNote,
  createdAt: r.createdAt.toISOString(),
});

const loadInScope = async (id: string, scope: StoreScope): Promise<{ request: IHrRequest; name: string }> => {
  const request = isUuid(id) ? await GrievanceQuery.findRequest(id) : null;
  if (!request) throw new CustomException(NOT_FOUND, notFound);
  const employee = await assertEmployeeInScope(request.employeeId, scope).catch(() => {
    throw new CustomException(NOT_FOUND, notFound);
  });
  return { request, name: employee.name };
};

const list = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { ids } = await employeeIdsInScope(scope);
    const { items, total } = await GrievanceQuery.listRequests({
      employeeIds: ids,
      status: optionalOneOf(queryString(query.status, "status"), REQUEST_STATUSES, "status"),
      category: optionalOneOf(queryString(query.category, "category"), REQUEST_CATEGORIES, "category"),
      offset: page.offset,
      limit: page.limit,
    });
    const names = await directoryOf(items.map((r) => r.employeeId));
    return toPage(items.map((r) => toView(r, names.get(r.employeeId)?.name ?? "Unknown")), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const get = async (scope: StoreScope, id: string) => {
  try {
    const { request, name } = await loadInScope(id, scope);
    return toView(request, name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const respond = async (user: RequestUser, scope: StoreScope, id: string, body: unknown) => {
  try {
    const message = text(parseBody(body).message, "message", 4000);
    const { request, name } = await loadInScope(id, scope);
    const done = await inHrTransaction((tx) => GrievanceQuery.respondToRequest(request.id, message, clock.now(), actorName(user), tx));
    if (!done) throw new CustomException("This request has already been answered or closed.", conflict);
    return toView((await GrievanceQuery.findRequest(id)) as IHrRequest, name);
  } catch (error) {
    throw toCustomException(error);
  }
};

const close = async (scope: StoreScope, id: string, body: unknown) => {
  try {
    const note = nullableText(parseBody(body).note, "note", 1000) ?? null;
    const { request, name } = await loadInScope(id, scope);
    const done = await inHrTransaction((tx) => GrievanceQuery.closeRequest(request.id, note, clock.now(), tx));
    if (!done) throw new CustomException("This request is already closed.", conflict);
    return toView((await GrievanceQuery.findRequest(id)) as IHrRequest, name);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------- self-service (used by the ESS routes)

const send = async (employee: IEmployeeRef, body: unknown) => {
  try {
    const input = parseBody(body);
    const created = await GrievanceQuery.createRequest({
      employeeId: employee.id,
      category: oneOf(input.category, REQUEST_CATEGORIES, "category"),
      message: text(input.message, "message", 4000),
    });
    return toView(created);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listMine = async (employee: IEmployeeRef, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await GrievanceQuery.listRequests({
      employeeIds: null,
      employeeId: employee.id,
      status: optionalOneOf(queryString(query.status, "status"), REQUEST_STATUSES, "status"),
      offset: page.offset,
      limit: page.limit,
    });
    return toPage(items.map((r) => ({ id: r.id, category: r.category, status: r.status, createdAt: r.createdAt.toISOString() })), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMine = async (employee: IEmployeeRef, id: string) => {
  try {
    const request = isUuid(id) ? await GrievanceQuery.findRequest(id) : null;
    if (!request || request.employeeId !== employee.id) throw new CustomException(NOT_FOUND, notFound);
    return toView(request);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const HrRequestService = { list, get, respond, close, send, listMine, getMine };
