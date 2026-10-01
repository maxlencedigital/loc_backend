export type OutboxKind = "order_status" | "order_payment";
export type OutboxState = "pending" | "done" | "dead";

export interface IOutbox {
  id: string;
  kind: OutboxKind;
  orderId: string;
  jobId: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
}

export type IOutboxCreate = Pick<IOutbox, "kind" | "orderId" | "jobId" | "payload" | "dedupeKey">;
