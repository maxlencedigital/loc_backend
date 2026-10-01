export interface IPrepaidPackage {
  id: string;
  name: string;
  pricePaise: number;
  creditPaise: number;
  validityDays: number;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type IPackageCreate = Omit<IPrepaidPackage, "id" | "createdAt" | "updatedAt">;
export type IPackageUpdate = Partial<IPackageCreate>;

export type CustomerPackageStatus = "pending" | "active" | "exhausted" | "expired";

export interface ICustomerPackage {
  id: string;
  customerId: string;
  packageId: string;
  packageName: string;
  pricePaise: number;
  creditPaise: number;
  validityDays: number;
  remainingCreditPaise: number;
  status: CustomerPackageStatus;
  orderRef: string;
  expiresAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ICustomerPackageCreate = Pick<
  ICustomerPackage,
  "id" | "customerId" | "packageId" | "packageName" | "pricePaise" | "creditPaise" | "validityDays" | "orderRef"
>;

export interface ICustomerPackageFilter {
  customerId?: string;
  packageId?: string;
  /** Effective status as the API reports it: an active row past its expiry counts as expired. */
  status?: "active" | "exhausted" | "expired";
  now: Date;
}
