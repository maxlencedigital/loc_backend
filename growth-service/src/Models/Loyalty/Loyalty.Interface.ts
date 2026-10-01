export type LoyaltyTransactionType = "earn" | "redeem" | "expire" | "adjust";

export interface ILoyaltyProgram {
  pointsPerRupeeMilli: number;
  redemptionValuePaise: number;
  expiryDays: number | null;
}

export interface ILoyaltyTier {
  name: string;
  minPoints: number;
  benefits: string[];
}

export interface ILoyaltyAccount {
  id: string;
  customerId: string;
  points: number;
  lifetimePoints: number;
  lastEarnAt: Date;
}

export interface ILoyaltyTransaction {
  id: string;
  customerId: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  reason: string;
  orderRef: string | null;
  actorId: string | null;
  createdAt: Date;
}

export type ILoyaltyTransactionCreate = Omit<ILoyaltyTransaction, "id" | "createdAt">;

export interface ILoyaltyTransactionFilter {
  customerId?: string;
  from?: Date;
  to?: Date;
}
