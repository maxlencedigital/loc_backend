import type { OrderStatus } from "../Order/OrderStatus.js";
import type { OrderPaymentStatus, OrderPriority } from "../Order/Order.Interface.js";

export const ADDRESS_LABELS = ["home", "office", "other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export const FABRICS = ["cotton", "linen", "wool", "silk", "synthetic", "blend", "denim", "leather", "unknown"] as const;
export type Fabric = (typeof FABRICS)[number];

export const PAYMENT_METHODS = ["online", "cash_on_delivery", "package"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PhotoOwner = "order" | "garment_profile";

export interface ICustomerProfile {
  id: string;
  userId: string;
  customerId: string;
  defaultAddressId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAddress {
  id: string;
  customerId: string;
  label: AddressLabel;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IAddressInput = Omit<IAddress, "id" | "customerId" | "createdAt" | "updatedAt">;

export interface IGarmentProfile {
  id: string;
  customerId: string;
  name: string;
  garmentTypeId: string | null;
  fabric: Fabric;
  colour: string;
  brand: string;
  washInstructions: string[];
  avoid: string[];
  notes: string;
  isFavourite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type IGarmentProfileInput = Omit<IGarmentProfile, "id" | "customerId" | "createdAt" | "updatedAt">;

export interface IPhoto {
  id: string;
  customerId: string;
  ownerType: PhotoOwner;
  ownerId: string;
  itemId: string | null;
  url: string;
  note: string;
  createdAt: Date;
}

export type IPhotoInput = Pick<IPhoto, "itemId" | "url" | "note">;

export interface ISlotConfig {
  slotMinutes: number;
  capacityPerSlot: number;
  leadMinutes: number;
  horizonDays: number;
}

export interface ISlot {
  id: string;
  storeId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
}

export interface ISlotWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface ICustomerOrderExt {
  id: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string | null;
  pickupSlotId: string;
  pickupFrom: Date;
  pickupTo: Date;
  pickupAddressId: string | null;
  pickupAddress: string;
  deliveryAddressId: string | null;
  deliveryAddress: string;
  paymentMethod: Exclude<PaymentMethod, "package">;
}

export type ICustomerOrderExtCreate = Omit<ICustomerOrderExt, "id">;

export interface ICustomerOrderLine {
  orderId: string;
  orderItemId: string;
  customerId: string;
  garmentTypeId: string;
  garmentProfileId: string | null;
  fabric: Fabric;
  note: string;
}

/** What the order history needs per order: no items, no timeline. */
export interface IOrderRow {
  id: string;
  ref: string;
  status: OrderStatus;
  priority: OrderPriority;
  paymentStatus: OrderPaymentStatus;
  storeId: string;
  amountPaise: number;
  placedAt: Date;
}

export interface IOrderListFilter {
  statuses?: OrderStatus[];
  // Narrows "booked" into customer-visible placed (no slot) and pickup_scheduled (slot).
  hasPickupSlot?: boolean;
  from?: Date;
  to?: Date;
  offset: number;
  limit: number;
}

export interface IGarmentVisit {
  orderId: string;
  storeId: string;
  storeName: string;
  placedAt: Date;
  service: string;
  careNote: string;
}

/** The order as another service sees it. */
export interface IInternalOrder {
  id: string;
  ref: string;
  storeId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  priority: OrderPriority;
  paymentStatus: OrderPaymentStatus;
  amountPaise: number;
  address: string;
  promisedAt: Date;
}

export interface IOrderSummaryFilter {
  from: Date;
  to: Date;
  storeId: string | null;
}

export interface IOrderSummaryRows {
  byStatus: { status: OrderStatus; orders: number }[];
  byStore: { storeId: string; orders: number; revenuePaise: number }[];
  byDay: { date: string; orders: number; revenuePaise: number }[];
}
