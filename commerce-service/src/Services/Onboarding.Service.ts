import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  IOnboardingItem,
  ITemplateItem,
  ONBOARDING_CATEGORIES,
  ONBOARDING_STATUSES,
} from "../Models/Hr/Employee.Interface.js";
import { EmployeeQuery } from "../Queries/Employee.Query.js";
import { inHrTransaction } from "../Queries/Hr.Transaction.js";
import { OnboardingQuery } from "../Queries/Onboarding.Query.js";
import { clock } from "../Utils/HrDate.js";
import { normaliseKey } from "../Utils/HrInput.js";
import { oneOf, optionalOneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { EMPLOYEE_NOT_FOUND } from "./EmployeeAccess.js";

export const DEFAULT_TEMPLATE_ROLE = "default";
const MAX_TEMPLATE_ITEMS = 50;
const ROLE_KEY_MAX = 40;

/** The checklist a new joiner of this job role gets: their role's own, else the default. */
export const resolveTemplate = async (role: string, db?: Parameters<typeof OnboardingQuery.templateItems>[1]) => {
  const own = await OnboardingQuery.templateItems(normaliseKey(role), db);
  return own.length > 0 ? own : await OnboardingQuery.templateItems(DEFAULT_TEMPLATE_ROLE, db);
};

const roleKey = (value: string): string => {
  const key = normaliseKey(typeof value === "string" ? value : "");
  if (key === "" || key.length > ROLE_KEY_MAX) {
    throw new CustomException(`role must be 1 to ${ROLE_KEY_MAX} letters or digits.`, badRequest);
  }
  return key;
};

const toItemView = (item: IOnboardingItem) => ({
  id: item.id,
  title: item.title,
  category: item.category,
  status: item.status,
  ...(item.note ? { note: item.note } : {}),
  ...(item.doneAt ? { doneAt: item.doneAt.toISOString() } : {}),
});

const getForEmployee = async (employeeId: string, scope: StoreScope) => {
  try {
    const employee = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, scope) : null;
    if (!employee) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const items = await OnboardingQuery.listItems(employee.id);
    const done = items.filter((item) => item.status === "done").length;
    return {
      // Nothing required means nothing outstanding.
      completionPct: items.length === 0 ? 100 : Math.round((done / items.length) * 1000) / 10,
      items: items.map(toItemView),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateItem = async (employeeId: string, itemId: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const status = oneOf(body.status, ONBOARDING_STATUSES, "status");
    const note = optionalText(body.note, "note", 300);
    const employee = isUuid(employeeId) ? await EmployeeQuery.findById(employeeId, scope) : null;
    if (!employee || !isUuid(itemId)) throw new CustomException(EMPLOYEE_NOT_FOUND, notFound);
    const item = await OnboardingQuery.updateItem(employee.id, itemId, {
      status,
      note,
      doneAt: status === "done" ? clock.now() : null,
      updatedByUserId: user.id,
    });
    if (!item) throw new CustomException("Onboarding item not found.", notFound);
    return toItemView(item);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getTemplate = async (role: string) => {
  try {
    const key = roleKey(role);
    return { role: key, items: await OnboardingQuery.templateItems(key) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setTemplate = async (role: string, input: unknown) => {
  try {
    const key = roleKey(role);
    const body = parseBody(input);
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_TEMPLATE_ITEMS) {
      throw new CustomException(`items must be a list of 1 to ${MAX_TEMPLATE_ITEMS} entries.`, badRequest);
    }
    const items: ITemplateItem[] = body.items.map((raw: unknown) => {
      const entry = parseBody(raw);
      return {
        title: text(entry.title, "title", 120),
        category: optionalOneOf(entry.category, ONBOARDING_CATEGORIES, "category") ?? "induction",
      };
    });
    await inHrTransaction((tx) => OnboardingQuery.replaceTemplate(key, items, tx));
    return { role: key, items };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OnboardingService = { getForEmployee, updateItem, getTemplate, setTemplate };
