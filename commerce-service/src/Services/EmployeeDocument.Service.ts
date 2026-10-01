import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import { DOCUMENT_TYPES, IEmployeeDocument } from "../Models/Hr/Employee.Interface.js";
import { EmployeeDocumentQuery } from "../Queries/EmployeeDocument.Query.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { parseHttpsUrl } from "../Utils/HrInput.js";
import { oneOf, optionalText, parseBody, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

// The file itself lives in object storage; this record points at it.
const toDocumentView = (doc: IEmployeeDocument) => ({
  id: doc.id,
  type: doc.type,
  fileName: doc.fileName,
  uploadedAt: doc.uploadedAt.toISOString(),
  downloadUrl: doc.fileUrl,
  ...(doc.mimeType ? { mimeType: doc.mimeType } : {}),
  ...(doc.sizeBytes !== null ? { sizeBytes: doc.sizeBytes } : {}),
});

const requireEmployee = async (employeeId: string, scope: StoreScope) => {
  const employee = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, scope) : null;
  if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
  return employee;
};

const add = async (employeeId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const data = {
      type: oneOf(body.type, DOCUMENT_TYPES, "type"),
      fileName: text(body.fileName, "fileName", 200),
      fileUrl: parseHttpsUrl(body.fileUrl, "fileUrl", 500),
      mimeType: optionalText(body.mimeType, "mimeType", 100) ?? null,
      sizeBytes: body.sizeBytes === undefined || body.sizeBytes === null ? null : wholeNumber(body.sizeBytes, "sizeBytes", 1, MAX_FILE_BYTES),
    };
    if (/[\\/]/.test(data.fileName)) throw new CustomException("fileName must not contain a path.", badRequest);
    const employee = await requireEmployee(employeeId, scope);
    return toDocumentView(await EmployeeDocumentQuery.create({ ...data, employeeId: employee.id, uploadedByUserId: user.id }));
  } catch (error) {
    throw toCustomException(error);
  }
};

const list = async (employeeId: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const employee = await requireEmployee(employeeId, scope);
    const { items, total } = await EmployeeDocumentQuery.list(employee.id, page.offset, page.limit);
    return toPage(items.map(toDocumentView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (employeeId: string, docId: string, scope: StoreScope) => {
  try {
    const employee = await requireEmployee(employeeId, scope);
    if (!isUuid(docId) || !(await EmployeeDocumentQuery.remove(employee.id, docId))) {
      throw new CustomException("Document not found.", notFound);
    }
    return { id: docId, removed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const EmployeeDocumentService = { add, list, remove };
