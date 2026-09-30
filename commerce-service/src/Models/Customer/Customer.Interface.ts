export type CustomerType = "retail" | "corporate";

export const CUSTOMER_TYPES: CustomerType[] = ["retail", "corporate"];

export interface ICustomer {
  id: string;
  storeId: string;
  name: string;
  phone: string;
  email: string;
  type: CustomerType;
  orderCount: number;
  lifetimeValuePaise: number;
  lastOrderAt: Date | null;
  churnRisk: number;
  rating: number | null;
  addresses: string[];
  walletBalancePaise: number;
  loyaltyPoints: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerCreate {
  storeId: string;
  name: string;
  phone: string;
  email: string;
  type: CustomerType;
  addresses: string[];
  tags: string[];
}

export type ICustomerUpdate = Partial<Omit<ICustomerCreate, "storeId">>;

export interface ICustomerFilter {
  storeId: string | null;
  q?: string;
  type?: CustomerType;
  limit: number;
}
