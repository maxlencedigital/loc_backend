import type { CustomerType } from "../Customer/Customer.Interface.js";

export type ServiceDepartment = "laundry" | "dry_clean" | "finishing" | "household" | "premium" | "specialty";
export type ServiceUnit = "kg" | "piece" | "pair";
export type GarmentCategory = "men" | "women" | "kids" | "household" | "premium";

export const GARMENT_CATEGORIES: GarmentCategory[] = ["men", "women", "kids", "household", "premium"];

export interface IService {
  id: string;
  code: string;
  name: string;
  department: ServiceDepartment;
  unit: ServiceUnit;
  turnaroundHours: number;
  expressAvailable: boolean;
  active: boolean;
}

export interface IPriceList {
  id: string;
  name: string;
  appliesTo: string;
  active: boolean;
  storeId: string | null;
  customerType: CustomerType | null;
  updatedAt: Date;
  rowCount: number;
}

export interface IPriceListCreate {
  name: string;
  appliesTo: string;
  active: boolean;
  storeId: string | null;
  customerType: CustomerType | null;
}

export type IPriceListUpdate = Partial<Pick<IPriceListCreate, "name" | "appliesTo" | "active">>;

export interface IPriceRow {
  id: string;
  priceListId: string;
  serviceId: string;
  serviceName: string;
  unit: ServiceUnit;
  garment: string;
  category: GarmentCategory;
  ratePaise: number;
  expressRatePaise: number;
}

/** A price list with just the rows an order needs to be priced. */
export interface IPricingList {
  id: string;
  name: string;
  storeId: string | null;
  customerType: CustomerType | null;
  rows: Pick<IPriceRow, "serviceId" | "garment" | "category" | "ratePaise" | "expressRatePaise">[];
  // Set only on the global / area / store override lists (see PricingOverlay.Query): they
  // outrank plain lists by this number and price exact garments only, never a coarse booking.
  rank?: number;
  overlay?: boolean;
  source?: "global" | "area" | "store";
}
