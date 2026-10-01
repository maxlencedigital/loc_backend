export interface ICustomerStat {
  customerId: string;
  orderCount: number;
  totalSpentPaise: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastStoreId: string | null;
}

export interface ICustomerOrder {
  orderRef: string;
  customerId: string;
  storeId: string | null;
  amountPaise: number;
  completedAt: Date;
}

export const AUDIENCE_SEGMENTS = ["all", "new", "repeat", "inactive", "high_value", "at_risk"] as const;
export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

export interface IAudience {
  segment: AudienceSegment;
  storeIds?: string[];
  minOrders?: number;
  inactiveDays?: number;
}

export interface IWinBack {
  customerId: string;
  createdAt: Date;
}
