import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { isForeignKeyViolation, isUniqueViolation } from "../Queries/DatabaseError.js";
import { NotificationQuery } from "../Queries/Notification.Query.js";
import { NotificationHub } from "./NotificationHub.Service.js";
import type {
  INotification,
  INotificationPreference,
  INotificationTemplate,
  ITemplateCreate,
} from "../Models/Notification/Notification.Interface.js";
import {
  bodyOf,
  boolField,
  enumField,
  iso,
  onlyKeys,
  pathId,
  queryBool,
  queryDate,
  queryEnum,
  queryUuid,
  stringField,
  uuidField,
} from "../Utils/Input.js";
import { Limits, RateLimit } from "./RateLimit.Service.js";

export const CHANNELS = ["sms", "email", "whatsapp"] as const;
const STATUSES = ["queued", "sent", "failed"] as const;
const PREFERENCE_CHANNELS = ["sms", "email", "whatsapp", "push"] as const;
/** templateId recorded for free-form messages (campaigns, win-backs): the row keeps the text itself. */
export const CUSTOM_TEMPLATE = "custom";
const MAX_RETRY_ATTEMPTS = 3;
const MAX_PARAMS = 20;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

// Provider text never leaves the service: the log keeps a short category, details go to the server log.
export const safeError = (raw: string | undefined | null): string | null => {
  if (!raw) return null;
  return raw === "not configured" ? raw : "delivery failed";
};

const mask = (value: string): string => {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return value.length <= 4 ? "****" : `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
};

const toLogApi = (n: INotification) => ({
  id: n.id,
  customerId: n.customerId,
  channel: n.channel,
  status: n.status,
  sentAt: iso(n.sentAt),
  error: n.error,
  templateId: n.templateId,
  title: n.title,
  recipient: mask(n.recipient),
  attempts: n.attempts,
  campaignId: n.campaignId,
  createdAt: iso(n.createdAt),
});

const toInboxApi = (n: INotification) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  channel: n.channel,
  read: n.readAt !== null,
  at: iso(n.createdAt),
});

const resultOf = (n: INotification) => {
  if (n.status === "queued") return { delivered: false, error: "in progress" };
  return {
    delivered: n.status === "sent",
    ...(n.providerMessageId ? { providerMessageId: n.providerMessageId } : {}),
    ...(n.error ? { error: n.error } : {}),
  };
};

// One place that talks to the hub: a provider failure, or a template that no longer renders,
// is a failed result, never an exception.
const send = async (n: Pick<INotification, "channel" | "recipient" | "templateId" | "params" | "title" | "body">) => {
  try {
    const result =
      n.templateId === CUSTOM_TEMPLATE
        ? await NotificationHub.dispatchText({ channel: n.channel as "sms" | "email", to: n.recipient, subject: n.title, text: n.body })
        : await NotificationHub.dispatch({ channel: n.channel, to: n.recipient, templateId: n.templateId, params: n.params });
    return result.delivered
      ? { status: "sent" as const, providerMessageId: result.providerMessageId ?? null, error: null }
      : { status: "failed" as const, providerMessageId: null, error: safeError(result.error ?? "failed") };
  } catch (error) {
    console.error("[Notification] dispatch rejected:", (error as Error).message);
    return { status: "failed" as const, providerMessageId: null, error: "delivery failed" };
  }
};

// ----------------------------------------------------------------- internal

const parseParams = (raw: unknown): Record<string, string> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > MAX_PARAMS) {
    throw new CustomException(`params must be an object of at most ${MAX_PARAMS} text values.`, badRequest);
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || value.length > 500) {
      throw new CustomException("params values must be text of at most 500 characters.", badRequest);
    }
    params[key] = value;
  }
  return params;
};

/** POST /internal/notifications/dispatch. A provider failure is `delivered: false`, never an error. */
const dispatch = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["channel", "to", "templateId"]);
    const channel = enumField(input.channel, "channel", CHANNELS);
    const to = stringField(input.to, "to", 3, 254);
    const templateId = stringField(input.templateId, "templateId", 1, 100);
    const params = parseParams(input.params);
    const customerId = input.customerId === undefined || input.customerId === null ? null : uuidField(input.customerId, "customerId");
    const idempotencyKey = input.idempotencyKey === undefined ? null : stringField(input.idempotencyKey, "idempotencyKey", 1, 128);
    if (templateId === CUSTOM_TEMPLATE) throw new CustomException(`"${CUSTOM_TEMPLATE}" is reserved.`, badRequest);

    // Validates template and params exactly as the hub will: a caller bug is a 400, recorded nowhere.
    const { title, body: text } = NotificationHub.preview({ channel, to, templateId, params });

    if (idempotencyKey) {
      const earlier = await NotificationQuery.findByKey(idempotencyKey);
      if (earlier) return resultOf(earlier);
    }

    // The customer's own channel switches decide whether we contact them at all.
    const preference = customerId ? await NotificationQuery.findPreference(customerId) : null;
    const optedOut = preference ? !preference[channel] : false;

    if (!optedOut) {
      const { max, windowMs } = Limits.notifyPerRecipient();
      if (!(await RateLimit.allow(`notify:${channel}:${RateLimit.hashed(to)}`, max, windowMs))) {
        return { delivered: false, error: "rate limited" };
      }
    }

    let row: INotification;
    try {
      row = await NotificationQuery.create({ customerId, channel, recipient: to, templateId, params, title, body: text, idempotencyKey, campaignId: null });
    } catch (error) {
      if (idempotencyKey && isUniqueViolation(error)) {
        const winner = await NotificationQuery.findByKey(idempotencyKey);
        if (winner) return resultOf(winner);
      }
      throw error;
    }

    if (optedOut) return resultOf(await NotificationQuery.complete(row.id, { status: "failed", error: "opted out" }));
    return resultOf(await NotificationQuery.complete(row.id, await send(row)));
  } catch (error) {
    throw toCustomException(error);
  }
};

/** Free-form message to one customer, logged like any other (used by win-back). */
const sendText = async (input: { customerId: string; channel: "sms" | "email"; to: string; subject: string; text: string }) => {
  try {
    const row = await NotificationQuery.create({
      customerId: input.customerId,
      channel: input.channel,
      recipient: input.to,
      templateId: CUSTOM_TEMPLATE,
      params: {},
      title: input.subject,
      body: input.text,
      idempotencyKey: null,
      campaignId: null,
    });
    return await NotificationQuery.complete(row.id, await send(row));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------------- customer

const listMine = async (customerId: string, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await NotificationQuery.listForCustomer(customerId, queryBool(query.unread, "unread") === true, page);
    return toPage(items.map(toInboxApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const markRead = async (customerId: string, id: unknown) => {
  try {
    const notificationId = pathId(id);
    // Someone else's notification is a 404, exactly like one that does not exist.
    if (!(await NotificationQuery.markRead(notificationId, customerId))) throw new CustomException("Notification not found.", notFound);
    return { id: notificationId, read: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const preferencesApi = (p: INotificationPreference | null) => ({
  channels: { sms: p?.sms ?? true, email: p?.email ?? true, whatsapp: p?.whatsapp ?? true, push: p?.push ?? false },
  language: p?.language ?? "en",
  quietHours: p?.quietFrom && p?.quietTo ? { from: p.quietFrom, to: p.quietTo } : null,
});

const getPreferences = async (customerId: string) => {
  try {
    return preferencesApi(await NotificationQuery.findPreference(customerId));
  } catch (error) {
    throw toCustomException(error);
  }
};

const setPreferences = async (customerId: string, body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["channels"]);
    onlyKeys(input, ["channels", "language", "quietHours"]);
    const channels = bodyOf(input.channels);
    onlyKeys(channels, PREFERENCE_CHANNELS);
    const data: Record<string, unknown> = {};
    for (const key of PREFERENCE_CHANNELS) if (channels[key] !== undefined) data[key] = boolField(channels[key], `channels.${key}`);
    if (input.language !== undefined) {
      const language = stringField(input.language, "language", 2, 5);
      if (!LANGUAGE.test(language)) throw new CustomException("language must look like en or en-IN.", badRequest);
      data.language = language;
    }
    if (input.quietHours !== undefined) {
      if (input.quietHours === null) {
        data.quietFrom = null;
        data.quietTo = null;
      } else {
        const quiet = bodyOf(input.quietHours);
        requireFields(quiet, ["from", "to"]);
        if (typeof quiet.from !== "string" || !TIME.test(quiet.from) || typeof quiet.to !== "string" || !TIME.test(quiet.to)) {
          throw new CustomException("quietHours from and to must be HH:MM.", badRequest);
        }
        data.quietFrom = quiet.from;
        data.quietTo = quiet.to;
      }
    }
    return preferencesApi(await NotificationQuery.savePreference(customerId, data));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- templates

const toTemplateApi = (t: INotificationTemplate) => ({
  id: t.id,
  name: t.name,
  channel: t.channel,
  body: t.body,
  variables: t.variables,
  language: t.language,
  isActive: t.isActive,
  createdAt: iso(t.createdAt),
  updatedAt: iso(t.updatedAt),
});

export const placeholdersOf = (body: string): string[] => [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]))];

const TEMPLATE_KEYS = ["name", "channel", "body", "variables", "language", "isActive"] as const;

const buildTemplate = (input: Record<string, unknown>, base: ITemplateCreate | null): ITemplateCreate => {
  onlyKeys(input, TEMPLATE_KEYS);
  const next: ITemplateCreate = base ?? { name: "", channel: "sms", body: "", variables: [], language: "en", isActive: true };
  if (input.name !== undefined) next.name = stringField(input.name, "name", 1, 80);
  if (input.channel !== undefined) next.channel = enumField(input.channel, "channel", CHANNELS);
  if (input.body !== undefined) next.body = stringField(input.body, "body", 1, 1000);
  if (input.language !== undefined) {
    next.language = stringField(input.language, "language", 2, 5);
    if (!LANGUAGE.test(next.language)) throw new CustomException("language must look like en or en-IN.", badRequest);
  }
  if (input.isActive !== undefined) next.isActive = boolField(input.isActive, "isActive");
  const used = placeholdersOf(next.body);
  if (input.variables !== undefined) {
    if (!Array.isArray(input.variables) || input.variables.length > 20) throw new CustomException("variables must be a short list of names.", badRequest);
    next.variables = [...new Set(input.variables.map((v) => stringField(v, "variable", 1, 40)))];
  } else if (input.body !== undefined || base === null) {
    next.variables = used;
  }
  const missing = used.filter((u) => !next.variables.includes(u));
  if (missing.length > 0) throw new CustomException(`The body uses {{${missing[0]}}} which is not listed in variables.`, badRequest);
  return next;
};

const listTemplates = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await NotificationQuery.listTemplates(page);
    return toPage(items.map(toTemplateApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const createTemplate = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["name", "channel", "body"]);
    try {
      return toTemplateApi(await NotificationQuery.createTemplate(buildTemplate(input, null)));
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A template with this name already exists.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const getTemplate = async (id: unknown) => {
  try {
    const template = await NotificationQuery.findTemplate(pathId(id));
    if (!template) throw new CustomException("Template not found.", notFound);
    return toTemplateApi(template);
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateTemplate = async (id: unknown, body: unknown) => {
  try {
    const templateId = pathId(id);
    const input = bodyOf(body);
    const current = await NotificationQuery.findTemplate(templateId);
    if (!current) throw new CustomException("Template not found.", notFound);
    const { id: _id, createdAt: _c, updatedAt: _u, ...base } = current;
    try {
      const updated = await NotificationQuery.updateTemplate(templateId, buildTemplate(input, base));
      if (!updated) throw new CustomException("Template not found.", notFound);
      return toTemplateApi(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new CustomException("A template with this name already exists.", conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const deleteTemplate = async (id: unknown) => {
  try {
    const templateId = pathId(id);
    try {
      if (!(await NotificationQuery.deleteTemplate(templateId))) throw new CustomException("Template not found.", notFound);
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new CustomException("This template is used by a campaign. Deactivate it instead.", conflict);
      throw error;
    }
    return { deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

// --------------------------------------------------------------- admin log

const listLog = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await NotificationQuery.list(
      {
        channel: queryEnum(query.channel, "channel", CHANNELS),
        status: queryEnum(query.status, "status", STATUSES),
        customerId: queryUuid(query.customerId, "customerId"),
        from: queryDate(query.from, "from"),
        to: queryDate(query.to, "to", true),
      },
      page
    );
    return toPage(items.map(toLogApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getLogEntry = async (id: unknown) => {
  try {
    const entry = await NotificationQuery.findById(pathId(id));
    if (!entry) throw new CustomException("Notification not found.", notFound);
    return { ...toLogApi(entry), body: entry.body };
  } catch (error) {
    throw toCustomException(error);
  }
};

const retry = async (id: unknown) => {
  try {
    const notificationId = pathId(id);
    const entry = await NotificationQuery.findById(notificationId);
    if (!entry) throw new CustomException("Notification not found.", notFound);
    // The claim is one conditional update, so two admins clicking retry send once.
    if (!(await NotificationQuery.claimRetry(notificationId, MAX_RETRY_ATTEMPTS))) {
      throw new CustomException(`Only a failed notification can be retried, up to ${MAX_RETRY_ATTEMPTS} attempts.`, conflict);
    }
    const outcome = await send(entry);
    const done = await NotificationQuery.complete(notificationId, outcome);
    return { ...toLogApi(done), body: done.body };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const NotificationService = {
  dispatch, sendText, listMine, markRead, getPreferences, setPreferences,
  listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate,
  listLog, getLogEntry, retry,
};
