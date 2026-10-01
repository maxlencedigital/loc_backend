import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type {
  INotification,
  INotificationCreate,
  INotificationFilter,
  INotificationOutcome,
  INotificationPreference,
  INotificationTemplate,
  IPreferenceUpdate,
  ITemplateCreate,
  ITemplateUpdate,
} from "../Models/Notification/Notification.Interface.js";

type Paging = { offset: number; limit: number };

const toNotificationData = (data: INotificationCreate): Prisma.NotificationUncheckedCreateInput => ({
  ...data,
  params: data.params as Prisma.InputJsonValue,
});

const create = async (data: INotificationCreate): Promise<INotification> => {
  try {
    return (await prisma.notification.create({ data: toNotificationData(data) })) as unknown as INotification;
  } catch (error) {
    throw error;
  }
};

const createMany = async (rows: INotificationCreate[]): Promise<void> => {
  try {
    if (rows.length > 0) await prisma.notification.createMany({ data: rows.map(toNotificationData) });
  } catch (error) {
    throw error;
  }
};

const findById = async (id: string): Promise<INotification | null> => {
  try {
    return (await prisma.notification.findUnique({ where: { id } })) as unknown as INotification | null;
  } catch (error) {
    throw error;
  }
};

const findByKey = async (idempotencyKey: string): Promise<INotification | null> => {
  try {
    return (await prisma.notification.findUnique({ where: { idempotencyKey } })) as unknown as INotification | null;
  } catch (error) {
    throw error;
  }
};

const complete = async (id: string, outcome: INotificationOutcome): Promise<INotification> => {
  try {
    return (await prisma.notification.update({
      where: { id },
      data: {
        status: outcome.status,
        providerMessageId: outcome.providerMessageId ?? null,
        error: outcome.error ?? null,
        sentAt: outcome.status === "sent" ? new Date() : null,
      },
    })) as unknown as INotification;
  } catch (error) {
    throw error;
  }
};

/** failed -> queued exactly once per caller: the status and attempt cap in the WHERE are the claim. */
const claimRetry = async (id: string, maxAttempts: number): Promise<boolean> => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { id, status: "failed", attempts: { lt: maxAttempts } },
      data: { status: "queued", error: null, attempts: { increment: 1 } },
    });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const range = (filter: { from?: Date; to?: Date }): Prisma.NotificationWhereInput =>
  filter.from || filter.to
    ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
    : {};

const list = async (filter: INotificationFilter, paging: Paging): Promise<{ items: INotification[]; total: number }> => {
  try {
    const where: Prisma.NotificationWhereInput = {
      ...(filter.channel ? { channel: filter.channel } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...range(filter),
    };
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.notification.count({ where }),
    ]);
    return { items: items as unknown as INotification[], total };
  } catch (error) {
    throw error;
  }
};

const listForCustomer = async (
  customerId: string,
  unreadOnly: boolean,
  paging: Paging
): Promise<{ items: INotification[]; total: number }> => {
  try {
    const where: Prisma.NotificationWhereInput = { customerId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.notification.count({ where }),
    ]);
    return { items: items as unknown as INotification[], total };
  } catch (error) {
    throw error;
  }
};

/** Marks one of the customer's own notifications read. False means it is not theirs or not there. */
const markRead = async (id: string, customerId: string): Promise<boolean> => {
  try {
    const owned = await prisma.notification.count({ where: { id, customerId } });
    if (owned === 0) return false;
    await prisma.notification.updateMany({ where: { id, customerId, readAt: null }, data: { readAt: new Date() } });
    return true;
  } catch (error) {
    throw error;
  }
};

const findPreference = async (customerId: string): Promise<INotificationPreference | null> => {
  try {
    return (await prisma.notificationPreference.findUnique({ where: { customerId } })) as INotificationPreference | null;
  } catch (error) {
    throw error;
  }
};

const findPreferences = async (customerIds: string[]): Promise<INotificationPreference[]> => {
  try {
    return (await prisma.notificationPreference.findMany({
      where: { customerId: { in: customerIds } },
    })) as INotificationPreference[];
  } catch (error) {
    throw error;
  }
};

const savePreference = async (customerId: string, data: IPreferenceUpdate): Promise<INotificationPreference> => {
  try {
    return (await prisma.notificationPreference.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    })) as INotificationPreference;
  } catch (error) {
    throw error;
  }
};

const createTemplate = async (data: ITemplateCreate): Promise<INotificationTemplate> => {
  try {
    return (await prisma.notificationTemplate.create({ data })) as INotificationTemplate;
  } catch (error) {
    throw error;
  }
};

const findTemplate = async (id: string): Promise<INotificationTemplate | null> => {
  try {
    return (await prisma.notificationTemplate.findUnique({ where: { id } })) as INotificationTemplate | null;
  } catch (error) {
    throw error;
  }
};

const updateTemplate = async (id: string, data: ITemplateUpdate): Promise<INotificationTemplate | null> => {
  try {
    const { count } = await prisma.notificationTemplate.updateMany({ where: { id }, data });
    return count === 0 ? null : await findTemplate(id);
  } catch (error) {
    throw error;
  }
};

/** False when it did not exist. A campaign still using it makes the database refuse (foreign key). */
const deleteTemplate = async (id: string): Promise<boolean> => {
  try {
    const { count } = await prisma.notificationTemplate.deleteMany({ where: { id } });
    return count === 1;
  } catch (error) {
    throw error;
  }
};

const listTemplates = async (paging: Paging): Promise<{ items: INotificationTemplate[]; total: number }> => {
  try {
    const [items, total] = await prisma.$transaction([
      prisma.notificationTemplate.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.offset, take: paging.limit }),
      prisma.notificationTemplate.count(),
    ]);
    return { items: items as INotificationTemplate[], total };
  } catch (error) {
    throw error;
  }
};

export const NotificationQuery = {
  create,
  createMany,
  findById,
  findByKey,
  complete,
  claimRetry,
  list,
  listForCustomer,
  markRead,
  findPreference,
  findPreferences,
  savePreference,
  createTemplate,
  findTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
};
