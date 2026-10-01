// Plain domain types for the store-admin module. Money is integer paise, quantities integer
// thousandths, and a `date` is a business day written YYYY-MM-DD.

export type DayState = "open" | "counted" | "closed";

export interface IStoreDay {
  id: string;
  storeId: string;
  date: string;
  state: DayState;
  closedAt: Date | null;
  closedByName: string | null;
  closeNote: string | null;
  closedExpectedPaise: number | null;
  closedCountedPaise: number | null;
  closedVariancePaise: number | null;
}

export interface ICashCount {
  id: string;
  storeId: string;
  date: string;
  countedPaise: number;
  expectedPaise: number;
  variancePaise: number;
  denominations: Record<string, number> | null;
  note: string | null;
  countedByName: string;
  createdAt: Date;
}

export interface ICashCountCreate {
  storeId: string;
  date: string;
  countedPaise: number;
  expectedPaise: number;
  denominations: Record<string, number> | null;
  note: string | null;
  countedByUserId: string;
  countedByName: string;
}

export interface ICashDeposit {
  id: string;
  storeId: string;
  date: string;
  amountPaise: number;
  bankReference: string;
  depositedAt: Date;
  byName: string;
}

export interface ICashDepositCreate {
  storeId: string;
  date: string;
  amountPaise: number;
  bankReference: string;
  depositedAt: Date;
  byUserId: string;
  byName: string;
}

export type VarianceStatus = "open" | "explained" | "resolved";

export interface ICashVariance {
  id: string;
  storeId: string;
  date: string;
  amountPaise: number;
  status: VarianceStatus;
  note: string | null;
}

export interface IDayTotals {
  latestCount: ICashCount | null;
  depositedPaise: number;
  depositCount: number;
}

export interface IDayClose {
  closedAt: Date;
  closedByUserId: string;
  closedByName: string;
  closeNote: string | null;
  expectedPaise: number;
  countedPaise: number;
  variancePaise: number;
}

export type StockLevel = "ok" | "low" | "critical" | "out";
export type StockFlagLevel = "low" | "critical" | "out";
export type MovementKind = "consumption" | "receipt" | "correction";
export const MOVEMENT_KINDS: MovementKind[] = ["consumption", "receipt", "correction"];
export const STOCK_FLAG_LEVELS: StockFlagLevel[] = ["low", "critical", "out"];

export interface IStockItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantityMilli: number;
  reorderLevelMilli: number;
  updatedAt: Date;
}

export interface IStockAlertRow extends IStockItem {
  flagLevel: StockFlagLevel | null;
  flagNote: string | null;
  flagRaisedBy: string | null;
  flagRaisedAt: Date | null;
}

export interface IStockFlagWrite {
  storeId: string;
  itemId: string;
  level: StockFlagLevel;
  note: string | null;
  byUserId: string;
  byName: string;
}

export interface IStockMovementWrite {
  storeId: string;
  itemId: string;
  kind: MovementKind;
  deltaMilli: number;
  reason: string | null;
  byUserId: string | null;
  byName: string;
  idempotencyKey: string | null;
}

export interface IStockMovement {
  id: string;
  storeId: string;
  itemId: string;
  kind: MovementKind;
  deltaMilli: number;
  quantityAfterMilli: number;
  reason: string | null;
  byName: string;
  createdAt: Date;
}

export interface IResourceReading {
  id: string;
  storeId: string;
  date: string;
  waterMilliLitres: number | null;
  electricityMilliKwh: number | null;
  detergentMilliKg: number | null;
  notes: string | null;
  byName: string;
}

export interface IResourceReadingCreate {
  storeId: string;
  date: string;
  waterMilliLitres: number | null;
  electricityMilliKwh: number | null;
  detergentMilliKg: number | null;
  notes: string | null;
  byUserId: string;
  byName: string;
}

export interface IArea {
  id: string;
  name: string;
  city: string;
  pincodes: string[];
  storeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAreaWrite {
  name: string;
  city: string;
  pincodes: string[];
}

export type PriceScope = "global" | "area" | "store";

export interface IPriceOverride {
  id: string;
  scope: PriceScope;
  scopeId: string;
  serviceId: string;
  garmentTypeId: string;
  garment: string;
  category: string;
  ratePaise: number;
  expressRatePaise: number;
  updatedAt: Date;
}

export interface IPriceOverrideWrite {
  serviceId: string;
  garmentTypeId: string;
  garment: string;
  category: string;
  ratePaise: number;
  expressRatePaise: number;
}

export interface IPriceChangeWrite {
  scope: PriceScope;
  scopeId: string;
  serviceId: string;
  garmentTypeId: string;
  fromPaise: number | null;
  toPaise: number | null;
  byUserId: string;
  byName: string;
}

export interface IPriceChange extends Omit<IPriceChangeWrite, "byUserId"> {
  id: string;
  byUserId: string | null;
  at: Date;
}

export interface IGarmentTypeRef {
  garmentTypeId: string;
  garment: string;
  category: string;
}

export interface IFabricRuleView {
  id: string;
  fabric: string;
  risk: string;
  handling: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStoreMetrics {
  storeId: string;
  orders: number;
  revenuePaise: number;
  delivered: number;
  onTime: number;
}

export interface IStaffMember {
  employeeId: string;
  name: string;
  role: string;
  gatewayUserId: string | null;
  onShift: boolean;
}

export interface IStaffHandled {
  userId: string;
  ordersHandled: number;
  reworkedOrders: number;
}

export interface ICustomerStoreRow {
  storeId: string;
  orders: number;
  spendPaise: number;
  lastOrderAt: Date | null;
}
