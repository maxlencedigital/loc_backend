export type CouponType = "percent" | "flat" | "free_delivery";

export interface ICoupon {
  id: string;
  code: string;
  title: string;
  type: CouponType;
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  validFrom: Date;
  validUntil: Date;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  storeIds: string[];
  firstOrderOnly: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ICouponCreate = Omit<ICoupon, "id" | "usedCount" | "createdAt" | "updatedAt">;
export type ICouponUpdate = Partial<ICouponCreate>;

export interface ICouponRedemption {
  id: string;
  couponId: string;
  customerId: string;
  orderRef: string;
  orderValuePaise: number;
  discountPaise: number;
  createdAt: Date;
}

export type IRedemptionCreate = Omit<ICouponRedemption, "id" | "createdAt">;

export interface ICouponUsage {
  redemptions: number;
  totalDiscountPaise: number;
  uniqueCustomers: number;
}
