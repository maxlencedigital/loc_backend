export type StoreStatus = "live" | "planned" | "closed";
export type StoreType = "processing" | "pickup_hub" | "franchise";

export const STORE_STATUSES: StoreStatus[] = ["live", "planned", "closed"];
export const STORE_TYPES: StoreType[] = ["processing", "pickup_hub", "franchise"];

export interface IStore {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  status: StoreStatus;
  type: StoreType;
  openingHours: string;
  capacityKgPerDay: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IStoreCreate = Omit<IStore, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type IStoreUpdate = Partial<Omit<IStoreCreate, "id" | "code">>;
