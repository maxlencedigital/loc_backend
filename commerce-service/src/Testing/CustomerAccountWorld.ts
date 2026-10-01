// A small shop to run the customer-account tests in: two stores, three services, one price
// list, and gateway accounts for customers. Built on the two in-memory fakes.
import crypto from "crypto";
import type { RequestUser } from "../Middleware/Identity.js";
import { reset as resetCore, seed } from "./InMemoryCommerce.js";
import { gateway, reset as resetMine, resetGateway } from "./InMemoryCustomerAccount.js";

export interface IWorld {
  storeA: any;
  storeB: any;
  washFold: any;
  dryClean: any;
  carpet: any;
}

export const buildWorld = (): IWorld => {
  resetCore();
  resetMine();
  resetGateway();
  const storeA = seed.store({ code: "BLR-IND", name: "Indiranagar Plant", city: "Bengaluru", openingHours: "07:00 – 21:00", capacityKgPerDay: 100 });
  const storeB = seed.store({ code: "HYD-GAC", name: "Gachibowli Plant", city: "Hyderabad", openingHours: "08:00 – 20:00", capacityKgPerDay: 100 });
  const washFold = seed.service({ code: "WASH_FOLD", name: "Wash & Fold", unit: "kg", expressAvailable: true });
  const dryClean = seed.service({ code: "DRY_CLEAN", name: "Dry Clean", unit: "piece", expressAvailable: true });
  const carpet = seed.service({ code: "CARPET", name: "Carpet Clean", unit: "piece", expressAvailable: false });
  const list = seed.list({ name: "Standard retail" });
  const row = (service: any, garment: string, category: string, ratePaise: number, expressRatePaise: number) =>
    seed.row({ priceListId: list.id, serviceId: service.id, garment, category, ratePaise, expressRatePaise });
  row(washFold, "Shirt", "men", 8000, 11600);
  row(dryClean, "Shirt", "men", 12000, 17400);
  row(dryClean, "Saree", "women", 25000, 36250);
  row(dryClean, "Suit", "premium", 40000, 58000);
  row(carpet, "Rug", "household", 50000, 50000);
  return { storeA, storeB, washFold, dryClean, carpet };
};

let counter = 0;

/** A gateway customer account and the identity the gateway would forward for it. */
export const signUp = (
  over: Partial<{ name: string; email: string | null; phoneNumber: string | null; isActive: boolean; role: string }> = {}
): RequestUser => {
  counter += 1;
  const userId = crypto.randomUUID();
  gateway.users.set(userId, {
    id: userId,
    name: "Ana Rao",
    email: `ana${counter}@example.com`,
    phoneNumber: `+9198450${String(10000 + counter)}`,
    role: "customer",
    storeId: null,
    isActive: true,
    ...over,
  });
  return { id: userId, role: (over.role as RequestUser["role"]) ?? "customer", storeId: null, scopeStoreId: null, name: over.name ?? "Ana Rao" };
};

export const asRole = (role: RequestUser["role"], storeId: string | null = null): RequestUser => ({
  id: crypto.randomUUID(),
  role,
  storeId,
  scopeStoreId: null,
  name: null,
});
