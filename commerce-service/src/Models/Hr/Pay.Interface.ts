// Plain domain types for pay, incentives and payouts. Money is integer paise,
// fractional quantities integer thousandths. No ORM types in here.

export const PAY_CYCLES = ["monthly", "weekly", "per_job"] as const;
export type PayCycle = (typeof PAY_CYCLES)[number];

export const INCENTIVE_APPLIES_TO = ["staff", "rider", "both"] as const;
export type IncentiveAppliesTo = (typeof INCENTIVE_APPLIES_TO)[number];

export const INCENTIVE_METRICS = ["jobs_completed", "orders_processed", "rating", "attendance", "distance"] as const;
export type IncentiveMetric = (typeof INCENTIVE_METRICS)[number];

export const INCENTIVE_PERIODS = ["daily", "weekly", "monthly"] as const;
export type IncentivePeriod = (typeof INCENTIVE_PERIODS)[number];

export const EARNING_STATUSES = ["pending", "approved", "paid"] as const;
export type EarningStatus = (typeof EARNING_STATUSES)[number];

export const PAYOUT_TYPES = ["salary", "incentive", "bonus", "advance"] as const;
export type PayoutType = (typeof PAYOUT_TYPES)[number];

export interface ICompensation {
  id: string;
  employeeId: string;
  baseSalaryPaise: number;
  payCycle: PayCycle;
  /** Allowance name to paise per pay cycle. */
  allowances: Record<string, number>;
  bonusEligible: boolean;
  effectiveFrom: Date;
  createdByName: string;
  createdAt: Date;
}

export type ICompensationCreate = Omit<ICompensation, "id" | "createdAt">;

export interface IIncentiveRule {
  thresholdMilli: number;
  rewardPaise: number;
}

export interface IIncentiveScheme {
  id: string;
  name: string;
  appliesTo: IncentiveAppliesTo;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  rules: IIncentiveRule[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ISchemeWrite = Omit<IIncentiveScheme, "id" | "createdAt" | "updatedAt">;

export interface IMetricValue {
  employeeId: string;
  metric: IncentiveMetric;
  period: string;
  valueMilli: number;
}

/** A scheme assigned to a person, as the evaluation of their metrics needs it. */
export interface IAssignedScheme {
  employeeId: string;
  scheme: IIncentiveScheme;
}

export interface IEarning {
  id: string;
  employeeId: string;
  schemeId: string;
  schemeName: string;
  period: string;
  periodStart: Date;
  periodEnd: Date;
  metricValueMilli: number;
  rewardPaise: number;
  status: EarningStatus;
  approvedAt: Date | null;
  approvedByName: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export type IEarningWrite = Pick<
  IEarning,
  "employeeId" | "schemeId" | "schemeName" | "period" | "periodStart" | "periodEnd" | "metricValueMilli" | "rewardPaise"
>;

export interface IEarningFilter {
  employeeIds: string[] | null;
  employeeId?: string;
  status?: EarningStatus;
  /** A month "2026-09" matches by date, any other value matches the stored period exactly. */
  periodMonth?: { from: Date; to: Date };
  periodExact?: string;
  offset: number;
  limit: number;
}

export interface IPayout {
  id: string;
  employeeId: string;
  amountPaise: number;
  type: PayoutType;
  period: string;
  paidOn: Date;
  reference: string | null;
  idempotencyKey: string | null;
  recordedByUserId: string;
  recordedByName: string;
  createdAt: Date;
}

export type IPayoutCreate = Omit<IPayout, "id" | "createdAt">;

export interface IPayoutFilter {
  employeeIds: string[] | null;
  employeeId?: string;
  type?: PayoutType;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}
