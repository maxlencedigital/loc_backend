import { randomUUID } from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { requireFields } from "../../commons/Utils/Validation.js";
import { inTransaction } from "../Queries/Db.js";
import { CampaignQuery } from "../Queries/Campaign.Query.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { NotificationQuery } from "../Queries/Notification.Query.js";
import { GatewayClient, type GatewayUser } from "../Clients/Gateway.Client.js";
import { NotificationHub } from "./NotificationHub.Service.js";
import { CHANNELS, CUSTOM_TEMPLATE, placeholdersOf, safeError } from "./Notification.Service.js";
import { parseAudience, toCriteria } from "./Audience.js";
import { Limits } from "./RateLimit.Service.js";
import type { ICampaign, ICampaignUpdate, RecipientStatus } from "../Models/Campaign/Campaign.Interface.js";
import type { INotificationCreate, INotificationPreference } from "../Models/Notification/Notification.Interface.js";
import {
  bodyOf,
  dateField,
  enumField,
  iso,
  onlyKeys,
  pathId,
  queryEnum,
  stringField,
  uuidField,
} from "../Utils/Input.js";

const STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
const LEASE_MS = 2 * 60_000;
const SEND_CONCURRENCY = 10;
const SAMPLE_SIZE = 10;
const MAX_MESSAGE = 1000;
const EDITABLE = ["draft", "scheduled"] as const;

// ------------------------------------------------------------------- shapes

const toApi = (c: ICampaign) => ({
  id: c.id,
  name: c.name,
  channel: c.channel,
  audience: c.audience,
  templateId: c.templateId,
  message: c.message,
  scheduledAt: iso(c.scheduledAt),
  status: c.status,
  startedAt: iso(c.startedAt),
  completedAt: iso(c.completedAt),
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

const firstName = (name: string | null | undefined): string => (name?.trim().split(/\s+/)[0] || "there").slice(0, 40);

// Single pass, so a value containing "{{x}}" is never expanded a second time.
export const renderMessage = (body: string, name: string): string => body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => (key === "name" ? name : ""));

// ------------------------------------------------------------------ content

// The text a campaign sends. Only {{name}} can be filled per recipient; anything else would go
// out as a blank, so it is refused up front.
const resolveContent = async (campaign: ICampaign): Promise<string> => {
  if (campaign.channel === "whatsapp") {
    throw new CustomException("WhatsApp campaigns need an approved marketing template, and none is registered yet.", badRequest);
  }
  let body: string | null = campaign.message;
  if (campaign.templateId) {
    const template = await NotificationQuery.findTemplate(campaign.templateId);
    if (!template || !template.isActive) throw new CustomException("The campaign template is missing or inactive.", badRequest);
    if (template.channel !== campaign.channel) throw new CustomException("The template is for a different channel.", badRequest);
    body = template.body;
  }
  if (!body) throw new CustomException("The campaign has no message.", badRequest);
  const unsupported = placeholdersOf(body).filter((p) => p !== "name");
  if (unsupported.length > 0) throw new CustomException(`Campaigns can only use {{name}}, not {{${unsupported[0]}}}.`, badRequest);
  return body;
};

const parseContentFields = async (input: Record<string, unknown>, channel: string) => {
  const templateId = input.templateId === undefined || input.templateId === null ? null : uuidField(input.templateId, "templateId");
  const message = input.message === undefined || input.message === null ? null : stringField(input.message, "message", 1, MAX_MESSAGE);
  if (templateId && message) throw new CustomException("Provide either templateId or message, not both.", badRequest);
  if (templateId) {
    const template = await NotificationQuery.findTemplate(templateId);
    if (!template) throw new CustomException("Template not found.", badRequest);
    if (template.channel !== channel) throw new CustomException("The template is for a different channel.", badRequest);
  }
  return { templateId, message };
};

const futureDate = (value: unknown, field: string): Date => {
  const date = dateField(value, field);
  if (date.getTime() <= Date.now()) throw new CustomException(`${field} must be in the future.`, badRequest);
  return date;
};

const requireStatusDraft = (value: unknown) => {
  if (value !== undefined && value !== "draft") {
    throw new CustomException("Use the schedule, send and cancel actions to change a campaign's status.", badRequest);
  }
};

// ------------------------------------------------------------------- CRUD

const list = async (query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const { items, total } = await CampaignQuery.list(
      { status: queryEnum(query.status, "status", STATUSES), channel: queryEnum(query.channel, "channel", CHANNELS) },
      page
    );
    return toPage(items.map(toApi), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (adminId: string, body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["name", "channel", "audience"]);
    onlyKeys(input, ["name", "channel", "audience", "templateId", "message", "scheduledAt", "status"]);
    requireStatusDraft(input.status);
    const channel = enumField(input.channel, "channel", CHANNELS);
    const content = await parseContentFields(input, channel);
    if (!content.templateId && !content.message) throw new CustomException("Provide a templateId or a message.", badRequest);
    return toApi(
      await CampaignQuery.create({
        name: stringField(input.name, "name", 1, 120),
        channel,
        audience: parseAudience(input.audience),
        ...content,
        scheduledAt: input.scheduledAt === undefined || input.scheduledAt === null ? null : futureDate(input.scheduledAt, "scheduledAt"),
        maxRecipients: Limits.campaignMaxRecipients(),
        createdBy: adminId,
      })
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

const findOrThrow = async (id: string): Promise<ICampaign> => {
  const campaign = await CampaignQuery.findById(id);
  if (!campaign) throw new CustomException("Campaign not found.", notFound);
  return campaign;
};

const get = async (id: unknown) => {
  try {
    return toApi(await findOrThrow(pathId(id)));
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: unknown, body: unknown) => {
  try {
    const campaignId = pathId(id);
    const input = bodyOf(body);
    onlyKeys(input, ["name", "channel", "audience", "templateId", "message", "scheduledAt", "status"]);
    const current = await findOrThrow(campaignId);
    if (input.status !== undefined && input.status !== current.status) {
      throw new CustomException("Use the schedule, send and cancel actions to change a campaign's status.", badRequest);
    }
    if (!(EDITABLE as readonly string[]).includes(current.status)) {
      throw new CustomException("Only a draft or scheduled campaign can be edited.", conflict);
    }

    const data: ICampaignUpdate = {};
    if (input.name !== undefined) data.name = stringField(input.name, "name", 1, 120);
    if (input.channel !== undefined) data.channel = enumField(input.channel, "channel", CHANNELS);
    if (input.audience !== undefined) data.audience = parseAudience(input.audience);
    if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt === null ? null : futureDate(input.scheduledAt, "scheduledAt");
    if (input.templateId !== undefined || input.message !== undefined || input.channel !== undefined) {
      // Content and channel are checked together, against what the campaign will look like.
      const merged = {
        templateId: input.templateId !== undefined ? input.templateId : input.message !== undefined ? null : current.templateId,
        message: input.message !== undefined ? input.message : input.templateId !== undefined ? null : current.message,
      };
      const content = await parseContentFields(merged, data.channel ?? current.channel);
      if (!content.templateId && !content.message) throw new CustomException("Provide a templateId or a message.", badRequest);
      data.templateId = content.templateId;
      data.message = content.message;
    }

    // The status check travels with the write, so a campaign that started meanwhile is not edited.
    if (!(await CampaignQuery.updateIn(campaignId, [...EDITABLE], data))) {
      throw new CustomException("Only a draft or scheduled campaign can be edited.", conflict);
    }
    return toApi(await findOrThrow(campaignId));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ----------------------------------------------------------- state machine

const schedule = async (id: unknown, body: unknown) => {
  try {
    const campaignId = pathId(id);
    const input = bodyOf(body);
    requireFields(input, ["scheduledAt"]);
    const scheduledAt = futureDate(input.scheduledAt, "scheduledAt");
    const campaign = await findOrThrow(campaignId);
    await resolveContent(campaign);
    if (!(await CampaignQuery.transition(campaignId, [...EDITABLE], "scheduled", { scheduledAt }))) {
      throw new CustomException(`A ${campaign.status} campaign cannot be scheduled.`, conflict);
    }
    return toApi(await findOrThrow(campaignId));
  } catch (error) {
    throw toCustomException(error);
  }
};

const cancel = async (id: unknown) => {
  try {
    const campaignId = pathId(id);
    const campaign = await findOrThrow(campaignId);
    if (!(await CampaignQuery.transition(campaignId, ["draft", "scheduled", "sending"], "cancelled", { cancelledAt: new Date() }))) {
      throw new CustomException(`A ${campaign.status} campaign cannot be cancelled.`, conflict);
    }
    return toApi(await findOrThrow(campaignId));
  } catch (error) {
    throw toCustomException(error);
  }
};

// ---------------------------------------------------------------- audience

const lookupNames = async (ids: string[]): Promise<Map<string, string | null>> => {
  try {
    return new Map((await GatewayClient.lookupUsers(ids)).map((u) => [u.id, u.name]));
  } catch {
    // Names are a courtesy in a preview; the count is the answer.
    return new Map();
  }
};

const previewAudience = async (body: unknown) => {
  try {
    const input = bodyOf(body);
    requireFields(input, ["audience"]);
    const criteria = toCriteria(parseAudience(input.audience), new Date());
    const [count, sampleIds] = await Promise.all([
      CustomerQuery.audienceCount(criteria),
      CustomerQuery.audienceBatch(criteria, null, SAMPLE_SIZE),
    ]);
    const names = await lookupNames(sampleIds);
    return { count, sample: sampleIds.map((customerId) => ({ customerId, name: names.get(customerId) ?? null })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------- send

type Skip = { customerId: string; reason: string };
interface Attempt {
  customerId: string;
  address: string;
  text: string;
  delivered: boolean;
  providerMessageId?: string;
  error: string | null;
}

const addressFor = (channel: string, user: GatewayUser): string | null => (channel === "email" ? user.email : user.phoneNumber);

// Sends in small concurrent groups: bounded fan-out, and a slow provider never holds hundreds of calls open.
const sendAll = async (
  campaign: ICampaign,
  body: string,
  targets: Array<{ customerId: string; address: string; name: string }>
): Promise<Attempt[]> => {
  const attempts: Attempt[] = [];
  for (let i = 0; i < targets.length; i += SEND_CONCURRENCY) {
    const group = targets.slice(i, i + SEND_CONCURRENCY);
    attempts.push(
      ...(await Promise.all(
        group.map(async (t): Promise<Attempt> => {
          const text = renderMessage(body, t.name);
          try {
            const result = await NotificationHub.dispatchText({
              channel: campaign.channel as "sms" | "email",
              to: t.address,
              subject: campaign.name,
              text,
            });
            return {
              customerId: t.customerId,
              address: t.address,
              text,
              delivered: result.delivered,
              providerMessageId: result.providerMessageId,
              error: result.delivered ? null : safeError(result.error ?? "failed"),
            };
          } catch (error) {
            console.error("[Campaign] dispatch rejected:", (error as Error).message);
            return { customerId: t.customerId, address: t.address, text, delivered: false, error: "delivery failed" };
          }
        })
      ))
    );
  }
  return attempts;
};

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
};

// One batch: gather (or claim) recipients, resolve contacts in one gateway call, honour opt-outs,
// send in small groups, then record results with a few grouped updates (never one per row).
const runBatch = async (campaign: ICampaign, body: string) => {
  const id = campaign.id;
  // Under the lease nobody else is sending, so `sending` rows are from a dead run: never retried.
  await CampaignQuery.failInterrupted(id);
  const fresh = await findOrThrow(id);
  if (fresh.status !== "sending") throw new CustomException(`The campaign is ${fresh.status}.`, conflict);

  const batchSize = Limits.campaignBatchSize();
  let rows = await CampaignQuery.pendingRecipients(id, batchSize);
  let exhausted = false;
  if (rows.length === 0) {
    const room = Math.min(batchSize, fresh.maxRecipients - fresh.claimedCount);
    const ids = room > 0 ? await CustomerQuery.audienceBatch(toCriteria(fresh.audience, fresh.startedAt ?? new Date()), fresh.cursor, room) : [];
    exhausted = ids.length < room || room <= 0 || fresh.claimedCount + ids.length >= fresh.maxRecipients;
    if (ids.length > 0) {
      await inTransaction((tx) => CampaignQuery.claimBatch(id, ids, ids[ids.length - 1], tx));
      rows = await CampaignQuery.pendingRecipients(id, batchSize);
    }
  }

  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  if (rows.length > 0) {
    const customerIds = rows.map((r) => r.customerId);
    // Looked up before anything is marked: if the gateway is down the rows simply stay pending.
    const users = new Map((await GatewayClient.lookupUsers(customerIds)).map((u) => [u.id, u]));
    const preferences = new Map<string, INotificationPreference>(
      (await NotificationQuery.findPreferences(customerIds)).map((p) => [p.customerId, p])
    );
    await CampaignQuery.markSending(id, customerIds);

    const skips: Skip[] = [];
    const targets: Array<{ customerId: string; address: string; name: string }> = [];
    for (const customerId of customerIds) {
      const user = users.get(customerId);
      const address = user ? addressFor(fresh.channel, user) : null;
      if (!user || !user.isActive) skips.push({ customerId, reason: "customer not found or inactive" });
      else if (preferences.get(customerId)?.[fresh.channel] === false) skips.push({ customerId, reason: "opted out" });
      else if (!address) skips.push({ customerId, reason: "no contact address" });
      else targets.push({ customerId, address, name: firstName(user.name) });
    }

    const attempts = await sendAll(fresh, body, targets);
    const now = new Date();
    const log: INotificationCreate[] = attempts.map((a) => ({
      id: randomUUID(),
      customerId: a.customerId,
      channel: fresh.channel,
      recipient: a.address,
      templateId: CUSTOM_TEMPLATE,
      params: {},
      title: fresh.name,
      body: a.text,
      status: a.delivered ? "sent" : "failed",
      providerMessageId: a.providerMessageId ?? null,
      error: a.error,
      sentAt: a.delivered ? now : null,
      idempotencyKey: null,
      campaignId: id,
    }));
    // Logging is bookkeeping; the recipients' final status below is what protects against a re-send.
    await NotificationQuery.createMany(log).catch((error) => console.error("[Campaign] could not log notifications:", (error as Error).message));

    const setAll = async (status: RecipientStatus, items: Array<{ customerId: string }>, error: string | null) =>
      CampaignQuery.setRecipientStatus(id, items.map((i) => i.customerId), status, error);
    const ok = attempts.filter((a) => a.delivered);
    await setAll("delivered", ok, null);
    for (const [error, group] of groupBy(attempts.filter((a) => !a.delivered), (a) => a.error ?? "delivery failed")) await setAll("failed", group, error);
    for (const [reason, group] of groupBy(skips, (s) => s.reason)) await setAll("skipped", group, reason);
    delivered = ok.length;
    failed = attempts.length - ok.length;
    skipped = skips.length;
  }

  let status: "sending" | "sent" = "sending";
  if (exhausted && (await CampaignQuery.transition(id, ["sending"], "sent", { completedAt: new Date() }))) status = "sent";
  const after = await findOrThrow(id);
  return {
    status: after.status === "cancelled" ? "cancelled" : status,
    processed: rows.length,
    delivered,
    failed,
    skipped,
    claimed: after.claimedCount,
    maxRecipients: after.maxRecipients,
    done: status === "sent",
  };
};

/**
 * Starts the campaign (draft or scheduled) or continues it, and processes ONE bounded batch.
 * There is no background worker on the free tier: the admin (or a scheduler) calls this again
 * until `done` is true.
 */
const send = async (id: unknown) => {
  try {
    const campaignId = pathId(id);
    const campaign = await findOrThrow(campaignId);
    if (!["draft", "scheduled", "sending"].includes(campaign.status)) {
      throw new CustomException(`A ${campaign.status} campaign cannot be sent.`, conflict);
    }
    const body = await resolveContent(campaign);
    if (campaign.status !== "sending") {
      if (!(await CampaignQuery.transition(campaignId, ["draft", "scheduled"], "sending", { startedAt: new Date() }))) {
        const now = await findOrThrow(campaignId);
        if (now.status !== "sending") throw new CustomException(`A ${now.status} campaign cannot be sent.`, conflict);
      }
    }
    const started = new Date();
    if (!(await CampaignQuery.acquireLease(campaignId, started, new Date(started.getTime() + LEASE_MS)))) {
      throw new CustomException("A batch of this campaign is already being sent. Try again in a moment.", conflict);
    }
    try {
      return await runBatch(campaign, body);
    } finally {
      await CampaignQuery.releaseLease(campaignId);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const stats = async (id: unknown) => {
  try {
    const campaignId = pathId(id);
    await findOrThrow(campaignId);
    const counts = await CampaignQuery.recipientCounts(campaignId);
    const delivered = counts.delivered ?? 0;
    const failed = counts.failed ?? 0;
    return {
      sent: delivered + failed,
      delivered,
      failed,
      skipped: counts.skipped ?? 0,
      pending: (counts.pending ?? 0) + (counts.sending ?? 0),
      // Open and click tracking needs provider webhooks, which are not wired.
      opened: 0,
      clicked: 0,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CampaignService = { list, create, get, update, schedule, cancel, previewAudience, send, stats };
