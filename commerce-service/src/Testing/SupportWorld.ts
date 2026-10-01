// A small shop for the support, feedback and payment tests: the account package's two stores
// and customers, plus helpers to place orders straight into the core fake and to make staff
// accounts the gateway fake knows about.
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { resolveCustomer } from "../Services/CustomerAccount.Service.js";
import { buildWorld, IWorld, signUp } from "./CustomerAccountWorld.js";
import { state as core } from "./InMemoryCommerce.js";
import { gateway } from "./InMemoryCustomerAccount.js";
import { reset as resetSupport } from "./InMemorySupport.js";

export { signUp };

export const buildSupportWorld = (): IWorld => {
  const world = buildWorld();
  resetSupport();
  return world;
};

export interface IShopper {
  user: RequestUser;
  customerId: string;
}

/** A signed-up customer whose core customer record exists (the account package creates it). */
export const shopper = async (over: Parameters<typeof signUp>[0] = {}): Promise<IShopper> => {
  const user = signUp(over);
  const { customer } = await resolveCustomer(user);
  return { user, customerId: customer.id };
};

let orderNumber = 24800;

export const addOrder = (customerId: string, storeId: string, over: Record<string, unknown> = {}) => {
  orderNumber += 1;
  const order = {
    id: crypto.randomUUID(),
    ref: `LOC-${orderNumber}`,
    storeId,
    customerId,
    status: "delivered",
    priority: "standard",
    paymentStatus: "unpaid",
    channel: "app",
    pieces: 2,
    weightGrams: 2000,
    amountPaise: 20000,
    placedAt: new Date(),
    promisedAt: new Date(),
    care: {},
    riderName: null,
    address: "12 MG Road",
    createdByUserId: null,
    items: [{ id: crypto.randomUUID(), serviceId: crypto.randomUUID(), serviceName: "Wash", garment: "Shirt", category: "men", unit: "kg", quantityMilli: 2000, ratePaise: 10000, amountPaise: 20000 }],
    events: [],
    ...over,
  };
  core.orders.set(order.id, order);
  return order as typeof order & { id: string };
};

/** A gateway account for a staff member or manager, and the identity the gateway forwards. */
export const staffMember = (
  role: "staff" | "manager" | "admin" | "hr",
  storeId: string | null,
  over: Partial<{ name: string; isActive: boolean }> = {}
): RequestUser => {
  const id = crypto.randomUUID();
  const name = over.name ?? `${role} ${id.slice(0, 4)}`;
  gateway.users.set(id, { id, name, email: null, phoneNumber: null, role, storeId, isActive: over.isActive ?? true });
  return { id, role, storeId, scopeStoreId: null, name };
};

export const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CustomException);
    expect((error as CustomException).errorCode).toBe(status);
    if (message) expect((error as CustomException).displayMessage).toMatch(message);
    return;
  }
  throw new Error("expected the call to be rejected");
};
