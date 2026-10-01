export type ExpenseStatus = "recorded" | "approved" | "rejected" | "paid";
export type SpendMode = "cash" | "bank" | "upi" | "card";
export type OperatingCostType =
  | "rent"
  | "electricity"
  | "water"
  | "internet"
  | "salary"
  | "insurance"
  | "maintenance"
  | "other";
export type CostFrequency = "monthly" | "quarterly" | "yearly";

export interface IExpenseCategory {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExpense {
  id: string;
  date: string;
  categoryId: string;
  amountPaise: number;
  storeId: string | null;
  vendorId: string | null;
  description: string | null;
  paymentMode: SpendMode | null;
  status: ExpenseStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IExpenseCreate {
  date: string;
  categoryId: string;
  amountPaise: number;
  storeId: string | null;
  vendorId: string | null;
  description: string | null;
  paymentMode: SpendMode | null;
  createdByUserId: string;
  idempotencyKey: string | null;
}

export type IExpenseUpdate = Partial<
  Pick<IExpense, "date" | "categoryId" | "amountPaise" | "storeId" | "vendorId" | "description" | "paymentMode">
>;

export interface IExpenseEvent {
  id: string;
  expenseId: string;
  action: string;
  fromStatus: ExpenseStatus | null;
  toStatus: ExpenseStatus;
  actorUserId: string;
  actorName: string | null;
  note: string | null;
  createdAt: Date;
}

export interface IExpenseEventCreate {
  expenseId: string;
  action: string;
  fromStatus: ExpenseStatus | null;
  toStatus: ExpenseStatus;
  actorUserId: string;
  actorName: string | null;
  note: string | null;
}

export interface IExpenseReceipt {
  id: string;
  expenseId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

export interface IExpenseFilter {
  storeId?: string | null;
  categoryId?: string;
  status?: ExpenseStatus;
  from?: string;
  to?: string;
}

export interface IOperatingCost {
  id: string;
  name: string;
  type: OperatingCostType;
  amountPaise: number;
  frequency: CostFrequency;
  storeId: string | null;
  dueDay: number | null;
  startDate: string;
  endDate: string | null;
  vendorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IOperatingCostCreate = Omit<IOperatingCost, "id" | "createdAt" | "updatedAt">;
export type IOperatingCostUpdate = Partial<IOperatingCostCreate>;
