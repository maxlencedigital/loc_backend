// Shared set-up for the store-floor tests: two stores, their staff, a priced catalogue, and
// helpers that drive the real services (over the in-memory fakes) through the floor workflow.
// The jest.mock calls that install the fakes live in each test file, so they are hoisted there.
import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { CheckInService } from "../Services/CheckIn.Service.js";
import { MachinesService } from "../Services/Machines.Service.js";
import { OrderService } from "../Services/Order.Service.js";
import { ProcessingService } from "../Services/Processing.Service.js";
import { QualityService } from "../Services/Quality.Service.js";
import { floor, resetFloor } from "./InMemoryStoreFloor.js";
import { reset, seed, state } from "./InMemoryCommerce.js";

export const w: Record<string, any> = {};

export const actor = (role: UserRole, storeId: string | null = null, name: string | null = null): RequestUser => ({
  id: `${role}-${name ?? storeId ?? "x"}`,
  role,
  storeId,
  scopeStoreId: null,
  name,
});

export const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

export const buildWorld = () => {
  reset();
  resetFloor();
  w.storeA = seed.store({ code: "BLR-IND" });
  w.storeB = seed.store({ code: "BLR-KOR" });
  w.ana = seed.customer({ storeId: w.storeA.id, phone: "+91 98450 12345", name: "Ana Rao", addresses: ["12 MG Road"] });
  w.bob = seed.customer({ storeId: w.storeB.id, phone: "+91 98450 33333", name: "Bob Iyer", addresses: ["4 Church Street"] });
  w.washFold = seed.service({ code: "WASH_FOLD", name: "Wash & Fold", unit: "kg", expressAvailable: true });
  w.dryClean = seed.service({ code: "DRY_CLEAN", name: "Dry Clean", unit: "piece", expressAvailable: true });
  const list = seed.list({ name: "Standard retail" });
  const row = (service: any, garment: string, category: string, rate: number, express: number) =>
    seed.row({ priceListId: list.id, serviceId: service.id, garment, category, ratePaise: rate, expressRatePaise: express });
  row(w.washFold, "Shirt", "men", 8000, 11600);
  row(w.dryClean, "Shirt", "men", 12000, 17400);
  row(w.dryClean, "Saree", "women", 25000, 36250);

  w.admin = actor("admin", null, "Vikram");
  w.managerA = actor("manager", w.storeA.id, "Meera Nair");
  w.staffA = actor("staff", w.storeA.id, "Sanjay");
  w.managerB = actor("manager", w.storeB.id, "Bina");
  w.staffB = actor("staff", w.storeB.id, "Sunil");
};

export const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};

export const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
};

export const line = (service: any, garment: string, category: string, qty: number) => ({ serviceId: service.id, garment, category, qty });

/** Books an order at a store as that store's manager (customer defaults to store A's). */
export const book = (lines: unknown[] = [line(w.dryClean, "Shirt", "men", 2)], extra: Record<string, unknown> = {}, user: RequestUser = w.managerA, customer = w.ana) =>
  OrderService.create(scopeOf(user), user, { customerId: customer.id, items: lines, ...extra, care: { colour: "white", ...((extra.care as object) ?? {}) } });

export const checkIn = (order: { id: string }, items: unknown[] = [{ garment: "Shirt", quantity: 2, fabric: "cotton" }], user: RequestUser = w.staffA) =>
  CheckInService.checkIn(order.id, scopeOf(user), user, { receivedFrom: "customer", items });

export const piecesOf = (orderId: string): any[] => [...floor.pieces.values()].filter((p) => p.orderId === orderId).sort((a, b) => a.tagCode.localeCompare(b.tagCode));

export const orderRow = (orderId: string): any => state.orders.get(orderId);

/** Gives every piece of an order the suggested process, which sorts it. */
export const sortAll = async (orderId: string, user: RequestUser = w.staffA) => {
  for (const piece of piecesOf(orderId)) {
    const suggestion = await CheckInService.getProcessSuggestion(orderId, piece.id, scopeOf(user));
    await CheckInService.setItemProcess(orderId, piece.id, scopeOf(user), user, {
      wash: suggestion.recommended.wash,
      dry: suggestion.recommended.dry,
    });
  }
};

export const bookSorted = async (lines?: unknown[], items?: unknown[], extra: Record<string, unknown> = {}) => {
  const order = await book(lines, extra);
  await checkIn(order, items);
  await sortAll(order.id);
  return order;
};

let machineCounter = 0;
export const addMachine = (storeId: string, type = "washer", capacityKg = 10, code = `M-${(machineCounter += 1)}`) =>
  MachinesService.registerMachine({ storeId, code, name: `${type} ${code}`, type, capacityKg });

export const newBatch = (user: RequestUser, pieceIds: string[], service: any = w.dryClean, extra: Record<string, unknown> = {}) =>
  ProcessingService.createBatch(scopeOf(user), user, { storeId: user.storeId, serviceId: service.id, orderItemIds: pieceIds, ...extra });

/** Runs one order's garments through a washing batch and a drying batch to quality check. */
export const washAndDry = async (orderId: string, user: RequestUser = w.staffA) => {
  const ids = piecesOf(orderId).map((p) => p.id);
  const washer = await addMachine(w.storeA.id, "washer");
  const dryer = await addMachine(w.storeA.id, "dryer");
  const wash = await newBatch(user, ids, w.dryClean, { machineId: washer.id });
  await ProcessingService.startBatch(wash.id, scopeOf(user), user);
  await ProcessingService.completeBatch(wash.id, scopeOf(user), user, {});
  const dry = await newBatch(user, ids, w.dryClean, { machineId: dryer.id });
  await ProcessingService.startBatch(dry.id, scopeOf(user), user);
  await ProcessingService.completeBatch(dry.id, scopeOf(user), user, {});
};

export const passAll = (orderId: string, user: RequestUser = w.staffA) =>
  QualityService.recordQualityCheck(orderId, scopeOf(user), user, {
    results: piecesOf(orderId).map((p) => ({ itemId: p.id, passed: true })),
  });
