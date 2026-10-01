import type { PageRequest } from "../../../commons/Utils/Pagination.js";

export const PAYMENT_METHOD_HINTS = ["card", "upi", "netbanking", "wallet"] as const;
export type PaymentMethodHint = (typeof PAYMENT_METHOD_HINTS)[number];

export type CustomerPaymentStatus = "created" | "authorized" | "captured" | "failed";

export interface ICustomerPayment {
  id: string;
  orderId: string;
  orderRef: string;
  customerUserId: string;
  amountPaise: number;
  currency: string;
  method: string | null;
  status: CustomerPaymentStatus;
  financePaymentId: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  keyId: string;
  idempotencyKey: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerPaymentCreate {
  orderId: string;
  orderRef: string;
  customerUserId: string;
  amountPaise: number;
  currency: string;
  method: string | null;
  financePaymentId: string | null;
  razorpayOrderId: string;
  keyId: string;
  idempotencyKey: string | null;
}

export interface ICustomerPaymentUpdate {
  status: CustomerPaymentStatus;
  razorpayPaymentId: string;
  financePaymentId: string;
  paidAt?: Date;
}

export interface ICustomerPaymentFilter {
  customerUserId: string;
  from?: Date;
  to?: Date;
  page: PageRequest;
}

export type SavedMethodType = "card" | "upi";

export interface ISavedMethod {
  id: string;
  customerUserId: string;
  type: SavedMethodType;
  providerToken: string;
  label: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
  createdAt: Date;
}

export interface ISavedMethodCreate {
  customerUserId: string;
  type: SavedMethodType;
  providerToken: string;
  label: string;
  brand: string | null;
  last4: string | null;
  isDefault: boolean;
}

/** The slice of a core order that payments, complaints and feedback need. */
export interface IOrderRef {
  id: string;
  ref: string;
  storeId: string;
  customerId: string;
  status: string;
  paymentStatus: "paid" | "unpaid" | "part_paid";
  amountPaise: number;
}
