export type ActivityEntity = "compliance_item" | "audit" | "audit_finding" | "incident";

export interface IActivity {
  id: string;
  entity: ActivityEntity;
  entityId: string;
  action: string;
  actorId: string;
  actorName: string | null;
  storeId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: Record<string, unknown> | null;
  at: Date;
}

export type IActivityCreate = Omit<IActivity, "id" | "at">;

export interface IActivityFilter {
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  actorId?: string;
  entity?: string;
  action?: string;
  /** Limits the trail to the stores a store-bound caller may see, plus store-less rows. */
  scope: string | null;
}
