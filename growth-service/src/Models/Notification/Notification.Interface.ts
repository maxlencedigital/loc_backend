export type NotificationChannel = "sms" | "email" | "whatsapp";
export type NotificationStatus = "queued" | "sent" | "failed";

export interface INotification {
  id: string;
  customerId: string | null;
  channel: NotificationChannel;
  recipient: string;
  templateId: string;
  params: Record<string, string>;
  title: string;
  body: string;
  status: NotificationStatus;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  idempotencyKey: string | null;
  campaignId: string | null;
  readAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type INotificationCreate = Pick<
  INotification,
  "customerId" | "channel" | "recipient" | "templateId" | "params" | "title" | "body" | "idempotencyKey" | "campaignId"
> & { id?: string; status?: NotificationStatus; error?: string | null; sentAt?: Date | null; providerMessageId?: string | null };

export interface INotificationOutcome {
  status: NotificationStatus;
  providerMessageId?: string | null;
  error?: string | null;
}

export interface INotificationFilter {
  channel?: NotificationChannel;
  status?: NotificationStatus;
  customerId?: string;
  from?: Date;
  to?: Date;
}

export interface INotificationPreference {
  customerId: string;
  sms: boolean;
  email: boolean;
  whatsapp: boolean;
  push: boolean;
  language: string;
  quietFrom: string | null;
  quietTo: string | null;
}

export type IPreferenceUpdate = Partial<Omit<INotificationPreference, "customerId">>;

export interface INotificationTemplate {
  id: string;
  name: string;
  channel: NotificationChannel;
  body: string;
  variables: string[];
  language: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ITemplateCreate = Omit<INotificationTemplate, "id" | "createdAt" | "updatedAt">;
export type ITemplateUpdate = Partial<ITemplateCreate>;
