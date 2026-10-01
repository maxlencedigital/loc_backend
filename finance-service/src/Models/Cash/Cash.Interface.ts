export type DailyCloseStatus = "closed" | "approved";
export type VarianceStatus = "open" | "resolved";

export interface IDailyClose {
  id: string;
  storeId: string;
  storeName: string | null;
  date: string;
  expectedPaise: number;
  closedByUserId: string | null;
  closedByName: string;
  status: DailyCloseStatus;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  approvalNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDailyCloseCreate {
  storeId: string;
  storeName: string | null;
  date: string;
  expectedPaise: number;
  countedPaise: number;
  closedByUserId: string | null;
  closedByName: string;
}

export interface ICashVariance {
  id: string;
  storeId: string;
  date: string;
  amountPaise: number;
  status: VarianceStatus;
  resolution: string | null;
  note: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Counted and banked cash for one store and day, summed from the cash book. */
export interface ICashTotals {
  storeId: string;
  countedPaise: number;
  bankedPaise: number;
}
