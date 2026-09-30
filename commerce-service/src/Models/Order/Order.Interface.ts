import type { GarmentCategory, ServiceUnit } from "../Catalog/Catalog.Interface.js";
import type { OrderStatus } from "./OrderStatus.js";

export type OrderPriority = "standard" | "express";
export type OrderPaymentStatus = "paid" | "unpaid" | "part_paid";
export type OrderChannel = "app" | "walk_in" | "web" | "phone";

export const ORDER_PRIORITIES: OrderPriority[] = ["standard", "express"];
export const ORDER_PAYMENT_STATUSES: OrderPaymentStatus[] = ["paid", "unpaid", "part_paid"];
export const ORDER_CHANNELS: OrderChannel[] = ["app", "walk_in", "web", "phone"];

export type RiskClass = "low" | "medium" | "high";
export type Colour = "white" | "light" | "dark" | "multi";
export type SoilLevel = "light" | "normal" | "heavy" | "stained";

export const RISK_CLASSES: RiskClass[] = ["low", "medium", "high"];
export const COLOURS: Colour[] = ["white", "light", "dark", "multi"];
export const SOIL_LEVELS: SoilLevel[] = ["light", "normal", "heavy", "stained"];

export interface ICareProfile {
  fabric: string;
  colour: Colour;
  soilLevel: SoilLevel;
  riskClass: RiskClass;
  flags: string[];
  customerNote: string | null;
  riderNote: string | null;
  photoCount: number;
  recommendedWash: string;
  recommendedDry: string;
}

export interface IOrderItem {
  id: string;
  serviceId: string;
  serviceName: string;
  garment: string;
  category: GarmentCategory;
  unit: ServiceUnit;
  quantityMilli: number;
  ratePaise: number;
  amountPaise: number;
}

export interface IOrderEvent {
  id: string;
  status: OrderStatus;
  byName: string;
  byUserId: string | null;
  note: string | null;
  at: Date;
}

export interface IOrder {
  id: string;
  ref: string;
  storeId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  priority: OrderPriority;
  paymentStatus: OrderPaymentStatus;
  channel: OrderChannel;
  pieces: number;
  weightGrams: number;
  amountPaise: number;
  placedAt: Date;
  promisedAt: Date;
  care: ICareProfile;
  riderName: string | null;
  address: string;
  items: IOrderItem[];
  events: IOrderEvent[];
}

export type IOrderItemCreate = Omit<IOrderItem, "id">;

export interface IOrderCreate {
  storeId: string;
  customerId: string;
  priority: OrderPriority;
  paymentStatus: OrderPaymentStatus;
  channel: OrderChannel;
  pieces: number;
  weightGrams: number;
  amountPaise: number;
  promisedAt: Date;
  care: ICareProfile;
  address: string;
  createdByUserId: string;
  items: IOrderItemCreate[];
  firstEvent: { byName: string; byUserId: string };
}

export interface IOrderFilter {
  storeId: string | null;
  statuses?: OrderStatus[];
  priority?: OrderPriority;
  paymentStatus?: OrderPaymentStatus;
  customerId?: string;
  q?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface IStatusChange {
  status: OrderStatus;
  note: string | null;
  byName: string;
  byUserId: string;
}

export interface IPipelineRow {
  status: OrderStatus;
  label: string;
  count: number;
}
