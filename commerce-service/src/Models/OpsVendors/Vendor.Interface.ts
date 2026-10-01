import type { IDocumentRef } from "../../Utils/OpsInput.js";
import type { DateString } from "../../Utils/OpsDates.js";

export const VENDOR_CATEGORIES = ["detergent", "packaging", "machinery", "spares", "it", "services", "other"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const MATERIAL_CATEGORIES = ["detergent", "softener", "packaging", "hangers", "chemicals", "other"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export interface IVendor {
  id: string;
  name: string;
  category: VendorCategory;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  paymentTerms: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IVendorWrite {
  name: string;
  category: VendorCategory;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  paymentTerms: string | null;
  bankAccountLast4: string | null;
  bankIfsc: string | null;
}

export interface IVendorCreate extends IVendorWrite {
  createdBy: string;
}

export type IVendorUpdate = Partial<IVendorWrite>;

export interface IVendorFilter {
  category?: VendorCategory;
  isActive?: boolean;
  q?: string;
  offset: number;
  limit: number;
}

export interface IAgreement {
  id: string;
  vendorId: string;
  title: string;
  startDate: DateString;
  endDate: DateString | null;
  terms: string | null;
  documents: IDocumentRef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgreementCreate {
  vendorId: string;
  title: string;
  startDate: DateString;
  endDate: DateString | null;
  terms: string | null;
  createdBy: string;
}

export interface IMaterial {
  id: string;
  name: string;
  category: MaterialCategory;
  unit: string;
  reorderLevelMilli: number;
  preferredVendorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMaterialWrite {
  name: string;
  category: MaterialCategory;
  unit: string;
  reorderLevelMilli: number;
  preferredVendorId: string | null;
}

export type IMaterialUpdate = Partial<IMaterialWrite>;

export interface IPage<T> {
  items: T[];
  total: number;
}
