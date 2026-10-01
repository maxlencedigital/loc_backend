import type { IAudience } from "../Customer/Customer.Interface.js";
import type { NotificationChannel } from "../Notification/Notification.Interface.js";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";
export type RecipientStatus = "pending" | "sending" | "delivered" | "failed" | "skipped";

export interface ICampaign {
  id: string;
  name: string;
  channel: NotificationChannel;
  audience: IAudience;
  templateId: string | null;
  message: string | null;
  status: CampaignStatus;
  scheduledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cursor: string | null;
  claimedCount: number;
  leaseUntil: Date | null;
  maxRecipients: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ICampaignCreate = Pick<
  ICampaign,
  "name" | "channel" | "audience" | "templateId" | "message" | "scheduledAt" | "maxRecipients" | "createdBy"
>;
export type ICampaignUpdate = Partial<Pick<ICampaign, "name" | "channel" | "audience" | "templateId" | "message" | "scheduledAt">>;

export interface ICampaignFilter {
  status?: CampaignStatus;
  channel?: NotificationChannel;
}

export interface ICampaignRecipient {
  id: string;
  campaignId: string;
  customerId: string;
  status: RecipientStatus;
  error: string | null;
}

export type RecipientCounts = Partial<Record<RecipientStatus, number>>;
