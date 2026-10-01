export const TICKET_STATUSES = ["open", "answered", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketAuthor = "customer" | "support";

export interface ITicket {
  id: string;
  customerUserId: string;
  subject: string;
  status: TicketStatus;
  orderId: string | null;
  storeId: string | null;
  messageCount: number;
  firstResponseAt: Date | null;
  answeredAt: Date | null;
  closedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITicketMessage {
  id: string;
  author: TicketAuthor;
  authorUserId: string | null;
  authorName: string;
  message: string;
  createdAt: Date;
}

export interface ITicketDetail extends ITicket {
  messages: ITicketMessage[];
}

export type INewTicketMessage = Omit<ITicketMessage, "id" | "createdAt">;

export interface ITicketCreate {
  customerUserId: string;
  subject: string;
  orderId: string | null;
  storeId: string | null;
  idempotencyKey: string | null;
  firstMessage: INewTicketMessage;
}

export interface ITicketPatch {
  status?: TicketStatus;
  firstResponseAt?: Date;
  answeredAt?: Date | null;
  closedAt?: Date;
}
