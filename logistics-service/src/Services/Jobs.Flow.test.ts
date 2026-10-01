import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor, scopeOfActor } from "../Middleware/StoreScope.js";

// The four Query modules are replaced by one in-memory database; services, the job state
// machine, eligibility and the outbox are the real code. Maps and the other services are fakes.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Job.Query.js", () => ({ JobQuery: require("../Testing/InMemoryLogistics.js").jobQuery }));
jest.mock("../Queries/Rider.Query.js", () => ({ RiderQuery: require("../Testing/InMemoryLogistics.js").riderQuery }));
jest.mock("../Queries/Earnings.Query.js", () => ({ EarningsQuery: require("../Testing/InMemoryLogistics.js").earningsQuery }));
jest.mock("../Queries/Outbox.Query.js", () => ({ OutboxQuery: require("../Testing/InMemoryLogistics.js").outboxQuery }));
jest.mock("../Clients/Maps.Client.js", () => ({
  MapsClient: { isConfigured: jest.fn(), geocode: jest.fn(), getRoute: jest.fn() },
}));
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { get: jest.fn(), post: jest.fn() } }));

import { MapsClient } from "../Clients/Maps.Client.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { reset, seed, state } from "../Testing/InMemoryLogistics.js";
import { DispatchJobService } from "./DispatchJob.Service.js";
import { InternalJobService } from "./InternalJob.Service.js";
import { OrderSyncService } from "./OrderSync.Service.js";
import { RiderDeliveryService } from "./RiderDelivery.Service.js";
import { RiderEarningsService } from "./RiderEarnings.Service.js";
import { RiderJobService } from "./RiderJob.Service.js";
import { RiderPickupService } from "./RiderPickup.Service.js";
import { RiderShiftService } from "./RiderShift.Service.js";
import { DispatchRiderService } from "./DispatchRider.Service.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";
const SIGNATURE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const actor = (role: Actor["role"], id: string, storeId: string | null = null, name: string | null = null): Actor => ({
  id,
  role,
  storeId,
  scopeStoreId: null,
  name,
});
const managerA = actor("manager", "00000000-0000-4000-9000-00000000000a", STORE_A, "Meera Nair");
const staffA = actor("staff", "00000000-0000-4000-9000-00000000000b", STORE_A);
const managerB = actor("manager", "00000000-0000-4000-9000-00000000000c", STORE_B);
const admin = actor("admin", "00000000-0000-4000-9000-00000000000d");
const scopeOf = (a: Actor) => scopeOfActor(a);
const driver = (rider: { userId: string; name?: string }) => actor("driver", rider.userId, null, rider.name ?? null);

const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};
const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
  return error;
};

// ------------------------------------------------------------ the fake commerce
type Mode = "up" | "down" | "refuse";
let commerceMode: Mode;
let commerceCalls: Array<{ path: string; body: any }>;
let orderState: { amountPaise: number; paidPaise: number };

const commerceOrder = (id: string) => ({
  id,
  ref: "ORD-2001",
  storeId: STORE_A,
  customerName: "Ana Rao",
  customerPhone: "+919845012345",
  priority: "standard",
  paymentStatus: "unpaid",
  amountPaise: orderState.amountPaise,
  paidPaise: orderState.paidPaise,
  address: "12 MG Road, Bengaluru",
  deliveryAddress: "12 MG Road, Bengaluru",
  pickupWindow: null,
});

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  commerceMode = "up";
  commerceCalls = [];
  orderState = { amountPaise: 0, paidPaise: 0 };
  (MapsClient.isConfigured as jest.Mock).mockReturnValue(false);
  (MapsClient.geocode as jest.Mock).mockReset();
  (MapsClient.getRoute as jest.Mock).mockReset();
  (ServiceClient.post as jest.Mock).mockReset().mockImplementation(async (_to: string, path: string, options: any) => {
    commerceCalls.push({ path, body: options?.body });
    if (commerceMode === "down") throw new CustomException("A connected service is unavailable right now. Please try again.", 503);
    if (commerceMode === "refuse") throw new CustomException("A delivered order cannot change status.", 400);
    if (path.endsWith("/payment-status")) orderState.paidPaise = options.body.paidPaise;
    return {};
  });
  (ServiceClient.get as jest.Mock).mockReset().mockImplementation(async (_to: string, path: string) => {
    const id = path.split("/")[3];
    if (id === "00000000-0000-4000-8000-0000000fffff") throw new CustomException("Order not found.", 404);
    return commerceOrder(id);
  });
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

// ------------------------------------------------------------------- builders
const onShiftRider = (overrides: Record<string, unknown> = {}) => {
  const rider = seed.rider({ homeStoreId: STORE_A, ...overrides });
  seed.shift(rider.id);
  return rider as any;
};

const newJob = async (extra: Record<string, unknown> = {}) => {
  const orderId = (extra.orderId as string) ?? `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e9)).padStart(12, "0")}`;
  const { job } = await InternalJobService.createJob({
    orderId,
    orderRef: "ORD-2001",
    type: "pickup",
    storeId: STORE_A,
    address: { line1: "12 MG Road", city: "Bengaluru", pincode: "560001" },
    contactName: "Ana Rao",
    contactPhone: "9845012345",
    ...extra,
  });
  return job as any;
};

const assignTo = (jobId: string, rider: { id: string }, by: Actor = managerA) =>
  DispatchJobService.assign(by, scopeOf(by), jobId, { riderId: rider.id });

const status = (id: string) => (state.jobs.find((j) => j.id === id) as any).status;

// ================================================================ internal create
describe("POST /internal/jobs", () => {
  it("creates a job and replays idempotently on (orderId, type)", async () => {
    const orderId = "00000000-0000-4000-8000-0000000aaaaa";
    const first = await InternalJobService.createJob({ orderId, orderRef: "ORD-9", type: "pickup", storeId: STORE_A, address: { line1: "1 Main" }, contactName: "Ana", contactPhone: "9845012345" });
    const second = await InternalJobService.createJob({ orderId, orderRef: "ORD-9", type: "pickup", storeId: STORE_A, address: { line1: "different" }, contactName: "Ana", contactPhone: "9845012345" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.address.line1).toBe("1 Main");
    expect(state.jobs).toHaveLength(1);
    // The other type for the same order is a different job.
    const delivery = await InternalJobService.createJob({ orderId, orderRef: "ORD-9", type: "delivery", storeId: STORE_A, address: { line1: "1 Main" }, contactName: "Ana", contactPhone: "9845012345" });
    expect(delivery.created).toBe(true);
    expect(state.jobs).toHaveLength(2);
  });

  it("two simultaneous creates for one order produce one job", async () => {
    const orderId = "00000000-0000-4000-8000-0000000bbbbb";
    const body = { orderId, orderRef: "ORD-10", type: "delivery", storeId: STORE_A, address: "7 Church St", contactName: "Bo", contactPhone: "9845099999" };

    const [a, b] = await Promise.all([InternalJobService.createJob(body), InternalJobService.createJob(body)]);

    expect(state.jobs).toHaveLength(1);
    expect(a.job.id).toBe(b.job.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });

  it.each([
    ["no orderId", { orderId: undefined }],
    ["a malformed orderId", { orderId: "nope" }],
    ["an unknown type", { type: "teleport" }],
    ["no address", { address: undefined }],
    ["an invalid phone", { contactPhone: "123" }],
    ["a window that ends before it starts", { windowStart: "2026-10-02T10:00:00Z", windowEnd: "2026-10-02T09:00:00Z" }],
    ["a bad pincode", { address: { line1: "x", pincode: "12" } }],
    ["a negative amount", { amountToCollectPaise: -5 }],
  ])("refuses %s", async (_label, change) => {
    await refused(newJob(change), 400);
    expect(state.jobs).toHaveLength(0);
  });

  it("gives the order's owner a handover code, and nobody else", async () => {
    const job = await newJob();
    expect(job.handoverCode).toMatch(/^\d{6}$/);
    const seen = await DispatchJobService.get(null, job.id);
    expect(JSON.stringify(seen)).not.toContain(job.handoverCode);
  });

  it("lists a job by order for other services", async () => {
    const job = await newJob();
    const { jobs } = await InternalJobService.jobsForOrder({ orderId: job.orderId });
    expect(jobs.map((j: any) => j.id)).toEqual([job.id]);
    await refused(InternalJobService.jobsForOrder({ orderId: "x" }), 400);
  });
});

// ============================================================= Maps degradation
describe("Maps on job creation", () => {
  it("geocodes an address that has no coordinates", async () => {
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    (MapsClient.geocode as jest.Mock).mockResolvedValue({ lat: 12.9757, lng: 77.6011 });

    const job = await newJob();

    expect(job.address.latitude).toBe(12.9757);
    expect((MapsClient.geocode as jest.Mock).mock.calls[0][0]).toBe("12 MG Road, Bengaluru, 560001");
    expect((state.jobs[0] as any).coordinatesSource).toBe("geocoded");
  });

  it("does not geocode when the caller sent coordinates", async () => {
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    const job = await newJob({ address: { line1: "x", latitude: 1.5, longitude: 2.5 } });
    expect(MapsClient.geocode).not.toHaveBeenCalled();
    expect(job.address.latitude).toBe(1.5);
  });

  it.each([
    ["is not configured", () => (MapsClient.isConfigured as jest.Mock).mockReturnValue(false)],
    ["fails", () => {
      (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
      (MapsClient.geocode as jest.Mock).mockRejectedValue(new CustomException("Location lookup is unavailable right now.", 503));
    }],
    ["cannot find the address", () => {
      (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
      (MapsClient.geocode as jest.Mock).mockResolvedValue(null);
    }],
  ])("still creates the job when Maps %s", async (_label, arrange) => {
    arrange();
    const job = await newJob();
    expect(job.status).toBe("pending");
    expect(job.address.latitude).toBeNull();
  });

  it("gives up on a Maps call that is too slow", async () => {
    jest.useFakeTimers();
    try {
      (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
      (MapsClient.geocode as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const pending = newJob();
      await jest.advanceTimersByTimeAsync(3_500);
      expect((await pending).address.latitude).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ================================================================ pickup journey
describe("a pickup, from dispatch to the store", () => {
  it("runs the whole journey, tells commerce at each completion and pays the rider once", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    expect(status(job.id)).toBe("assigned");

    const started = await RiderJobService.start(driver(rider), job.id, { latitude: 12.97, longitude: 77.59 });
    expect(started.status).toBe("en_route");
    expect(commerceCalls).toHaveLength(0); // a pickup setting off changes nothing for the customer's order

    await RiderJobService.arrived(driver(rider), job.id, {});
    expect((await RiderPickupService.scan(driver(rider), job.id, { tagId: "TAG-1" })).scanned).toBe(1);
    expect(await RiderPickupService.scan(driver(rider), job.id, { tagId: "TAG-1" })).toMatchObject({ scanned: 1, duplicate: true });
    await RiderPickupService.scan(driver(rider), job.id, { tagId: "TAG-2", condition: "stain" });

    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 3, confirmation: "signature", signature: SIGNATURE }), 409, /scanned 2/);
    const confirmed = await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 2, confirmation: "signature", signature: SIGNATURE });
    expect(confirmed).toMatchObject({ status: "picked_up", itemCount: 2 });
    expect(commerceCalls.map((c) => [c.path, c.body.status])).toEqual([[`/internal/orders/${job.orderId}/status`, "picked_up"]]);
    expect(commerceCalls[0].body.actor).toEqual({ name: "Logistics" });

    await refused(RiderPickupService.handOff(driver(rider), job.id, { storeId: STORE_B, itemCount: 2 }), 409, /different store/);
    await refused(RiderPickupService.handOff(driver(rider), job.id, { storeId: STORE_A, itemCount: 5 }), 409, /count does not match/);
    expect(status(job.id)).toBe("picked_up");

    const done = await RiderPickupService.handOff(driver(rider), job.id, { storeId: STORE_A, itemCount: 2, notes: "left at the desk" });
    expect(done.status).toBe("at_store");
    expect(commerceCalls.map((c) => c.body.status)).toEqual(["picked_up", "received"]);

    expect(state.ledger.filter((l) => l.riderId === rider.id).map((l) => [l.kind, l.amountPaise])).toEqual([["job_base", 3500]]);
    expect(state.assignments.filter((a) => a.activeJobId !== null)).toHaveLength(0);
    const timeline = await DispatchJobService.timeline(null, job.id);
    expect(timeline.events.map((e: any) => e.status)).toEqual(["pending", "assigned", "en_route", "arrived", "picked_up", "at_store"]);
  });

  it("settles on a code instead of a signature, and locks the code after five wrong guesses", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    const wrong = await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "otp", otp: "000000" }), 400, /does not match/);
    expect((wrong.data as any).attemptsLeft).toBe(4);
    for (let i = 0; i < 4; i++) await rejection(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "otp", otp: "000000" }));
    // The right code no longer works: the rider has to take a signature.
    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "otp", otp: job.handoverCode }), 409, /sign instead/);
    expect((await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE })).status).toBe("picked_up");
  });

  it("accepts the right code the first time", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    const ok = await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "otp", otp: job.handoverCode });
    expect(ok.status).toBe("picked_up");
    expect((state.proofs[0] as any).otpVerified).toBe(true);
  });

  it("keeps the job completed when commerce is down, and the retry delivers it later", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    commerceMode = "down";

    const confirmed = await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });

    expect(confirmed.status).toBe("picked_up");
    expect(status(job.id)).toBe("picked_up");
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({ state: "pending", attempts: 1 });

    // Not due yet: the failed attempt pushed the next one out.
    expect(await OrderSyncService.retryPending()).toMatchObject({ processed: 0 });
    state.outbox[0].nextAttemptAt = new Date(Date.now() - 1000);
    commerceMode = "up";
    expect(await OrderSyncService.retryPending()).toMatchObject({ processed: 1, delivered: 1 });
    expect(state.outbox[0].state).toBe("done");
    expect(commerceCalls.filter((c) => !c.path.includes("payment")).map((c) => c.body.status)).toEqual(["picked_up", "picked_up"]);
  });

  it("gives up on an update commerce refuses on its merits, and says so", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    commerceMode = "refuse";

    await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });

    expect(status(job.id)).toBe("picked_up");
    expect(state.outbox[0]).toMatchObject({ state: "dead", lastError: "A delivered order cannot change status." });
  });

  it("stops retrying an outage after eight attempts", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    commerceMode = "down";
    await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });

    for (let i = 0; i < 10; i++) {
      state.outbox[0].nextAttemptAt = new Date(Date.now() - 1000);
      await OrderSyncService.retryPending();
    }
    expect(state.outbox[0].state).toBe("dead");
    expect(state.outbox[0].attempts).toBe(8);
  });

  it("two retry runs at once deliver a row once", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    commerceMode = "down";
    await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });
    commerceMode = "up";
    state.outbox[0].nextAttemptAt = new Date(Date.now() - 1000);
    commerceCalls.length = 0;

    const [a, b] = await Promise.all([OrderSyncService.retryPending(), OrderSyncService.retryPending()]);

    expect(commerceCalls).toHaveLength(1);
    expect(a.delivered + b.delivered).toBe(1);
  });

  it("requires an inspection before confirming a delicate pickup", async () => {
    const rider = onShiftRider();
    const itemId = "00000000-0000-4000-8000-0000000c0001";
    const job = await newJob({ isDelicate: true, items: [{ id: itemId, name: "Silk saree", careFlags: ["dry_clean"] }] });
    expect(job.requiresInspection).toBe(true);
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE }), 409, /inspection/);
    await refused(RiderPickupService.inspection(driver(rider), job.id, { items: [{ itemId: "00000000-0000-4000-8000-0000000c0002", condition: "ok" }] }), 400, /does not belong/);
    await refused(RiderPickupService.inspection(driver(rider), job.id, { items: [{ itemId, condition: "ok" }, { itemId, condition: "stain" }] }), 400);
    expect(await RiderPickupService.inspection(driver(rider), job.id, { items: [{ itemId, condition: "stain", note: "wine mark on hem" }], overallNote: "otherwise fine" })).toEqual({ recorded: 1 });

    expect((await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE })).status).toBe("picked_up");
    const proof = await DispatchJobService.proof(null, job.id);
    expect(proof.inspection).toEqual([{ itemId, condition: "stain", note: "wine mark on hem" }]);
  });

  it("validates pickup input and the step order", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    // Nothing at the door can happen before the rider has arrived.
    await refused(RiderPickupService.scan(driver(rider), job.id, { tagId: "T" }), 409, /arrived/);
    await refused(RiderJobService.arrived(driver(rider), job.id, {}), 409);
    await RiderJobService.start(driver(rider), job.id, {});
    await refused(RiderJobService.start(driver(rider), job.id, {}), 409);
    await RiderJobService.arrived(driver(rider), job.id, {});

    await refused(RiderPickupService.scan(driver(rider), job.id, {}), 400, /tagId/);
    await refused(RiderPickupService.scan(driver(rider), job.id, { tagId: "T", condition: "melted" }), 400);
    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 0, confirmation: "signature", signature: SIGNATURE }), 400);
    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "fingerprint" }), 400);
    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature" }), 400, /signature/);
    await refused(RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: "<script>" }), 400);
    await refused(RiderPickupService.photos(driver(rider), job.id, {}), 400, /photoUrl/);
    await refused(RiderPickupService.photos(driver(rider), job.id, { photoUrl: "http://insecure.example/a.jpg" }), 400);
    expect(await RiderPickupService.photos(driver(rider), job.id, { photoUrl: "https://files.example.com/a.jpg", caption: "door" })).toMatchObject({ caption: "door" });
    // A delivery step on a pickup is refused.
    await refused(RiderDeliveryService.confirm(driver(rider), job.id, { signature: SIGNATURE, receivedBy: "Ana", itemCount: 1 }), 409, /not a delivery/);
  });

  it("a job cannot be started by a rider who is off shift or suspended", async () => {
    const rider = seed.rider({ homeStoreId: STORE_A });
    const job = await newJob();
    await assignTo(job.id, rider);
    await refused(RiderJobService.start(driver(rider), job.id, {}), 409, /shift/);
    seed.shift(rider.id);
    (state.riders.find((r) => r.id === rider.id) as any).status = "suspended";
    await refused(RiderJobService.start(driver(rider), job.id, {}), 409, /cannot take jobs/);
  });
});

// ============================================================== delivery journey
describe("a delivery with money at the door", () => {
  const delivery = async (amountToCollectPaise: number) => {
    const rider = onShiftRider();
    const job = await newJob({ type: "delivery", amountToCollectPaise });
    orderState = { amountPaise: amountToCollectPaise, paidPaise: 0 };
    await assignTo(job.id, rider);
    return { rider, job };
  };

  it("tells commerce the order is out for delivery, takes the money, then completes", async () => {
    const { rider, job } = await delivery(25_000);
    const started = await RiderJobService.start(driver(rider), job.id, {});
    expect(started.status).toBe("out_for_delivery");
    expect(commerceCalls.map((c) => c.body.status)).toEqual(["out_for_delivery"]);
    await RiderJobService.arrived(driver(rider), job.id, {});

    // Still owed: the rider cannot complete yet.
    await refused(RiderDeliveryService.confirm(driver(rider), job.id, { signature: SIGNATURE, receivedBy: "Ana", itemCount: 3 }), 409, /payment/);

    const paid = await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 250 }, null);
    expect(paid).toMatchObject({ amount: 250, method: "cash", status: "collected", outstanding: 0 });
    expect(commerceCalls.at(-1)).toMatchObject({ path: `/internal/orders/${job.orderId}/payment-status`, body: { paymentStatus: "paid", paidPaise: 25_000 } });

    const done = await RiderDeliveryService.confirm(driver(rider), job.id, { signature: SIGNATURE, receivedBy: "Ana", itemCount: 3, otp: job.handoverCode });
    expect(done.status).toBe("delivered");
    expect(commerceCalls.at(-1)?.body.status).toBe("delivered");
    expect(state.ledger.map((l) => [l.kind, l.amountPaise])).toEqual([["job_base", 4500]]);
    expect(await RiderEarningsService.cashBalance(driver(rider))).toEqual({ collected: 250, settled: 0, outstanding: 250 });
  });

  it("refuses a second payment for what is already paid, and an overpayment", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 150 }, null), 400, /more than is due/);
    await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 60 }, null);
    expect(commerceCalls.at(-1)?.body).toMatchObject({ paymentStatus: "part_paid", paidPaise: 6000 });
    await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 40 }, null);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 1 }, null), 409, /already paid/);
    expect(commerceCalls.at(-1)?.body).toMatchObject({ paymentStatus: "paid", paidPaise: 10_000 });
  });

  it("validates a payment", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "barter", amount: 10 }, null), 400);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 0 }, null), 400);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: "abc" }, null), 400);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "upi", amount: 10 }, null), 400, /reference/);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 10 }, "bad key!"), 400);
    expect(state.payments).toHaveLength(0);
  });

  it("a card or UPI payment needs no hand-over, so it is settled at once", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    const paid = await RiderDeliveryService.payment(driver(rider), job.id, { method: "upi", amount: 100, reference: "UPI-123" }, null);
    expect(paid.status).toBe("settled");
    expect(await RiderEarningsService.cashBalance(driver(rider))).toEqual({ collected: 0, settled: 0, outstanding: 0 });
  });

  it("replays a retried payment with the same key instead of charging twice", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    const first = await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 40 }, "key-1");
    const again = await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 40 }, "key-1");

    expect(again.paymentId).toBe(first.paymentId);
    expect(state.payments).toHaveLength(1);
    expect((state.jobs[0] as any).collectedPaise).toBe(4000);
    await refused(RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 41 }, "key-1"), 409, /different payment/);
  });

  it("two simultaneous payments with the same key charge once", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    const results = await Promise.allSettled([
      RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 40 }, "race-key"),
      RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 40 }, "race-key"),
    ]);

    expect(state.payments).toHaveLength(1);
    expect((state.jobs[0] as any).collectedPaise).toBe(4000);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });

  it("two simultaneous payments cannot both claim the last of what is owed", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});

    const results = await Promise.allSettled([
      RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 100 }, null),
      RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 100 }, null),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((state.jobs[0] as any).collectedPaise).toBe(10_000);
    expect(state.payments).toHaveLength(1);
  });

  it("re-sends a payment update with the same paid total after a lost answer", async () => {
    const { rider, job } = await delivery(10_000);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    commerceMode = "down";
    await RiderDeliveryService.payment(driver(rider), job.id, { method: "cash", amount: 100 }, null);
    expect(state.outbox.find((o) => o.kind === "order_payment")?.state).toBe("pending");

    commerceMode = "up";
    const row = state.outbox.find((o) => o.kind === "order_payment") as any;
    row.nextAttemptAt = new Date(Date.now() - 1000);
    // The first attempt got as far as asking commerce for the order; the retry must not add the payment again.
    await OrderSyncService.retryPending();
    const sent = commerceCalls.filter((c) => c.path.endsWith("/payment-status"));
    expect(sent.at(-1)?.body.paidPaise).toBe(10_000);
    expect(row.state).toBe("done");
  });

  it("only the rider's own delivery photos are kept, to a limit", async () => {
    const { rider, job } = await delivery(0);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    for (let i = 0; i < 12; i++) await RiderDeliveryService.photos(driver(rider), job.id, { photoUrl: `https://files.example.com/${i}.jpg` });
    await refused(RiderDeliveryService.photos(driver(rider), job.id, { photoUrl: "https://files.example.com/13.jpg" }), 409, /at most 12/);
  });
});

// =============================================================== problems at the door
describe("reporting a problem", () => {
  const startedJob = async (type: "pickup" | "delivery" = "pickup") => {
    const rider = onShiftRider();
    const job = await newJob({ type });
    await assignTo(job.id, rider);
    await RiderJobService.start(driver(rider), job.id, {});
    return { rider, job };
  };

  it("fails the job and frees the rider", async () => {
    const { rider, job } = await startedJob();
    const result = await RiderJobService.reportIssue(driver(rider), job.id, { reason: "customer_unavailable", note: "phone off" });
    expect(result).toEqual({ status: "failed", rescheduled: false });
    expect(status(job.id)).toBe("failed");
    expect(state.assignments.filter((a) => a.activeJobId)).toHaveLength(0);
    await refused(RiderJobService.arrived(driver(rider), job.id, {}), 409);
  });

  it("reschedules: back in the queue with a new slot, no rider", async () => {
    const { rider, job } = await startedJob();
    const later = new Date(Date.now() + 26 * 3_600_000).toISOString();
    const result = await RiderJobService.reportIssue(driver(rider), job.id, { reason: "customer_unavailable", reschedule: true, rescheduleFor: later });
    expect(result).toEqual({ status: "pending", rescheduled: true });
    const stored = state.jobs[0] as any;
    expect(stored).toMatchObject({ status: "pending", riderId: null, rescheduleCount: 1, startedAt: null });
    expect(stored.slotFrom.toISOString()).toBe(later);
    // Dispatch can give it to someone else.
    const other = onShiftRider({ phone: "+919800000077" });
    expect((await assignTo(job.id, other)).riderId).toBe(other.id);
  });

  it.each([
    ["no reason", {}],
    ["an unknown reason", { reason: "bored" }],
    ["a reschedule without a time", { reason: "other", reschedule: true }],
    ["a reschedule in the past", { reason: "other", reschedule: true, rescheduleFor: "2020-01-01T00:00:00Z" }],
    ["a reschedule months away", { reason: "other", reschedule: true, rescheduleFor: new Date(Date.now() + 90 * 86_400_000).toISOString() }],
  ])("refuses %s", async (_label, body) => {
    const { rider, job } = await startedJob();
    await refused(RiderJobService.reportIssue(driver(rider), job.id, body), 400);
    expect(status(job.id)).toBe("en_route");
  });

  it("cannot be reported before setting off or after the handover", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await refused(RiderJobService.reportIssue(driver(rider), job.id, { reason: "other" }), 409);
    await RiderJobService.start(driver(rider), job.id, {});
    await RiderJobService.arrived(driver(rider), job.id, {});
    await RiderPickupService.confirm(driver(rider), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });
    await refused(RiderJobService.reportIssue(driver(rider), job.id, { reason: "other" }), 409);
  });
});

// ================================================================ isolation
describe("who can see and touch which job", () => {
  it("a rider reaches only their own job: every other access is a 404", async () => {
    const mine = onShiftRider();
    const theirs = onShiftRider({ phone: "+919800000055" });
    const job = await newJob();
    await assignTo(job.id, theirs);
    const me = driver(mine);

    await refused(RiderJobService.getOne(me, job.id), 404);
    await refused(RiderJobService.start(me, job.id, {}), 404);
    await refused(RiderJobService.arrived(me, job.id, {}), 404);
    await refused(RiderJobService.reportIssue(me, job.id, { reason: "other" }), 404);
    await refused(RiderPickupService.scan(me, job.id, { tagId: "T" }), 404);
    await refused(RiderPickupService.confirm(me, job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE }), 404);
    await refused(RiderPickupService.handOff(me, job.id, { storeId: STORE_A, itemCount: 1 }), 404);
    await refused(RiderDeliveryService.payment(me, job.id, { method: "cash", amount: 1 }, null), 404);
    await refused(RiderJobService.getOne(me, "not-a-uuid"), 404);
    expect((await RiderJobService.list(me, {})).items).toHaveLength(0);
    expect((await RiderJobService.list(driver(theirs), {})).items).toHaveLength(1);
    // A job nobody holds looks exactly the same.
    const unheld = await newJob();
    await refused(RiderJobService.getOne(me, unheld.id), 404);
  });

  it("a rider sees only their own earnings, cash and shifts", async () => {
    const a = onShiftRider();
    const b = onShiftRider({ phone: "+919800000056" });
    state.ledger.push({ id: "l1", riderId: a.id, kind: "job_base", amountPaise: 3500, createdAt: new Date() });
    expect((await RiderEarningsService.earnings(driver(a), {})).total).toBe(35);
    expect((await RiderEarningsService.earnings(driver(b), {})).total).toBe(0);
  });

  it("a driver with no rider profile has nothing to see", async () => {
    await refused(RiderJobService.list(actor("driver", "00000000-0000-4000-9000-0000000000ee"), {}), 404, /profile/);
  });

  it("a store manager sees and changes only their own store's jobs", async () => {
    const jobA = await newJob({ storeId: STORE_A });
    const jobB = await newJob({ storeId: STORE_B });
    const rider = onShiftRider();

    expect((await DispatchJobService.get(scopeOf(managerA), jobA.id)).id).toBe(jobA.id);
    await refused(DispatchJobService.get(scopeOf(managerA), jobB.id), 404);
    await refused(DispatchJobService.timeline(scopeOf(managerA), jobB.id), 404);
    await refused(DispatchJobService.proof(scopeOf(managerA), jobB.id), 404);
    await refused(DispatchJobService.update(managerA, scopeOf(managerA), jobB.id, { notes: "x" }), 404);
    await refused(assignTo(jobB.id, rider, managerA), 404);
    await refused(DispatchJobService.cancel(managerA, scopeOf(managerA), jobB.id, { reason: "x" }), 404);
    await refused(DispatchJobService.reassign(managerA, scopeOf(managerA), jobB.id, { riderId: rider.id, reason: "x" }), 404);

    const listed = await DispatchJobService.list(scopeOf(managerA), {});
    expect(listed.items.map((j: any) => j.id)).toEqual([jobA.id]);
    await refused(DispatchJobService.list(scopeOf(managerA), { storeId: STORE_B }), 404);
    expect((await DispatchJobService.unassigned(scopeOf(managerA), {})).jobs.map((j: any) => j.id)).toEqual([jobA.id]);
    await refused(DispatchJobService.autoAssign(managerA, scopeOf(managerA), { storeId: STORE_B }), 404);
    await refused(DispatchJobService.create(managerA, scopeOf(managerA), { orderId: "00000000-0000-4000-8000-0000000d0001", type: "pickup", storeId: STORE_B }), 404);
    expect(status(jobB.id)).toBe("pending");
  });

  it("an admin sees every store, or one chosen", async () => {
    await newJob({ storeId: STORE_A });
    await newJob({ storeId: STORE_B });
    expect((await DispatchJobService.list(scopeOf(admin), {})).total).toBe(2);
    expect((await DispatchJobService.list(scopeOf(admin), { storeId: STORE_B })).total).toBe(1);
    expect((await DispatchJobService.list(scopeOf({ ...admin, scopeStoreId: STORE_A }), {})).total).toBe(1);
  });

  it("a store's dispatcher cannot settle another store's cash", async () => {
    const rider = onShiftRider();
    const payment = (await seedCash(rider, STORE_B, 5000)) as any;
    await refused(DispatchRiderService.getFieldPayment(scopeOf(managerA), payment.id), 404);
    await refused(DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, { settledAmount: 50 }), 404);
    expect((await DispatchRiderService.listFieldPayments(scopeOf(managerA), {})).total).toBe(0);
    expect((await DispatchRiderService.listFieldPayments(scopeOf(managerB), {})).total).toBe(1);
  });
});

const seedCash = async (rider: any, storeId: string, amountPaise: number, method = "cash") => {
  const job = seed.job({ storeId, riderId: rider.id, type: "delivery" });
  state.payments.push({ id: `00000000-0000-4000-8000-0000000e${String(state.payments.length + 1).padStart(4, "0")}`, jobId: job.id, orderId: job.orderId, riderId: rider.id, storeId, amountPaise, method, reference: null, status: "collected", collectedAt: new Date(), settledAt: null, settledAmountPaise: null, idempotencyKey: null });
  return state.payments.at(-1);
};

// =============================================================== cash and settlement
describe("settling cash a rider collected", () => {
  it("settles exactly what was collected, once", async () => {
    const rider = onShiftRider();
    const payment = (await seedCash(rider, STORE_A, 25_000)) as any;
    expect(await DispatchRiderService.cashBalance(rider.id)).toEqual({ collected: 250, settled: 0, outstanding: 250 });

    await refused(DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, { settledAmount: 200 }), 409, /does not match/);
    await refused(DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, {}), 400);
    expect(await DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, { settledAmount: 250, note: "counted" })).toMatchObject({ status: "settled", settledAmount: 250 });
    await refused(DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, { settledAmount: 250 }), 409, /already settled/);
    expect(await DispatchRiderService.cashBalance(rider.id)).toEqual({ collected: 250, settled: 250, outstanding: 0 });
    expect((await DispatchRiderService.getFieldPayment(scopeOf(managerA), payment.id)).settledAmount).toBe(250);
  });

  it("two staff settling the same payment at once settle it once", async () => {
    const rider = onShiftRider();
    const payment = (await seedCash(rider, STORE_A, 10_000)) as any;
    const results = await Promise.allSettled([
      DispatchRiderService.settleFieldPayment(managerA, scopeOf(managerA), payment.id, { settledAmount: 100 }),
      DispatchRiderService.settleFieldPayment(staffA, scopeOf(staffA), payment.id, { settledAmount: 100 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("filters and pages field payments", async () => {
    const rider = onShiftRider();
    await seedCash(rider, STORE_A, 1000);
    await seedCash(rider, STORE_A, 2000);
    expect((await DispatchRiderService.listFieldPayments(scopeOf(admin), { status: "settled" })).total).toBe(0);
    const page = await DispatchRiderService.listFieldPayments(scopeOf(admin), { limit: "1", riderId: rider.id });
    expect(page).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(page.items).toHaveLength(1);
    await refused(DispatchRiderService.listFieldPayments(scopeOf(admin), { status: "lost" }), 400);
  });
});

// ================================================================ dispatch rules
describe("assigning, reassigning and cancelling", () => {
  it("assigns only to a rider who is eligible and available", async () => {
    const job = await newJob();
    const away = seed.rider({ available: false, phone: "+919800000061" });
    const suspended = seed.rider({ status: "suspended", phone: "+919800000062" });
    const lapsed = seed.rider({ insuranceExpiry: new Date(Date.now() - 3 * 86_400_000), phone: "+919800000063" });
    const noLogin = seed.rider({ userId: null, status: "inactive", phone: "+919800000064" });

    for (const rider of [away, suspended, lapsed, noLogin]) {
      const error = await refused(assignTo(job.id, rider), 409, /not available or not eligible/);
      expect((error.data as any).blockers.length).toBeGreaterThan(0);
    }
    expect(status(job.id)).toBe("pending");
    await refused(DispatchJobService.assign(managerA, scopeOf(managerA), job.id, { riderId: "00000000-0000-4000-8000-0000000ffff1" }), 404, /Rider/);
    await refused(DispatchJobService.assign(managerA, scopeOf(managerA), job.id, {}), 400);
  });

  it("works across stores: a rider is not tied to the store of the job", async () => {
    const rider = onShiftRider({ homeStoreId: STORE_B });
    const job = await newJob({ storeId: STORE_A });
    expect((await assignTo(job.id, rider)).riderId).toBe(rider.id);
  });

  it("two dispatchers assigning one job to different riders: one wins, the other is told", async () => {
    const r1 = onShiftRider();
    const r2 = onShiftRider({ phone: "+919800000071" });
    const job = await newJob();

    const results = await Promise.allSettled([assignTo(job.id, r1, managerA), assignTo(job.id, r2, staffA)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as CustomException).errorCode).toBe(409);
    expect(state.assignments.filter((a) => a.jobId === job.id && a.activeJobId)).toHaveLength(1);
    const holder = (state.jobs[0] as any).riderId;
    expect([r1.id, r2.id]).toContain(holder);
    expect(state.assignments.find((a) => a.activeJobId)?.riderId).toBe(holder);
  });

  it("refuses to give a rider more than the most they can hold", async () => {
    const rider = onShiftRider();
    for (let i = 0; i < 15; i++) seed.job({ riderId: rider.id, status: "assigned" });
    const job = await newJob();
    await refused(assignTo(job.id, rider), 409, /most jobs/);
  });

  it("reassigns, keeping a history and releasing the first rider", async () => {
    const r1 = onShiftRider();
    const r2 = onShiftRider({ phone: "+919800000072" });
    const job = await newJob();
    await assignTo(job.id, r1);
    await RiderJobService.start(driver(r1), job.id, {});

    await refused(DispatchJobService.reassign(managerA, scopeOf(managerA), job.id, { riderId: r2.id }), 400, /reason/);
    await refused(DispatchJobService.reassign(managerA, scopeOf(managerA), job.id, { riderId: r1.id, reason: "x" }), 400);
    const moved = await DispatchJobService.reassign(managerA, scopeOf(managerA), job.id, { riderId: r2.id, reason: "bike broke down" });

    expect(moved).toMatchObject({ riderId: r2.id, status: "assigned" });
    expect(state.assignments).toHaveLength(2);
    expect(state.assignments.filter((a) => a.activeJobId)).toHaveLength(1);
    expect(state.assignments.find((a) => a.riderId === r1.id)?.releaseReason).toMatch(/bike broke down/);
    // The first rider has lost it.
    await refused(RiderJobService.arrived(driver(r1), job.id, {}), 404);
    expect((await RiderJobService.getOne(driver(r2), job.id)).id).toBe(job.id);
  });

  it("a rider setting off while a dispatcher reassigns resolves cleanly: no job is left with two riders", async () => {
    const r1 = onShiftRider();
    const r2 = onShiftRider({ phone: "+919800000073" });
    const job = await newJob();
    await assignTo(job.id, r1);

    const [started, reassigned] = await Promise.allSettled([
      RiderJobService.start(driver(r1), job.id, {}),
      DispatchJobService.reassign(managerA, scopeOf(managerA), job.id, { riderId: r2.id, reason: "closer rider" }),
    ]);

    const stored = state.jobs[0] as any;
    expect(state.assignments.filter((a) => a.activeJobId)).toHaveLength(1);
    expect(state.assignments.find((a) => a.activeJobId)?.riderId).toBe(stored.riderId);
    if (reassigned.status === "fulfilled") expect(stored.riderId).toBe(r2.id);
    // Whoever lost was told, not silently overwritten.
    for (const result of [started, reassigned]) if (result.status === "rejected") expect([404, 409]).toContain((result.reason as CustomException).errorCode);
  });

  it("cannot reassign or cancel once the garments are collected", async () => {
    const r1 = onShiftRider();
    const r2 = onShiftRider({ phone: "+919800000074" });
    const job = await newJob();
    await assignTo(job.id, r1);
    await RiderJobService.start(driver(r1), job.id, {});
    await RiderJobService.arrived(driver(r1), job.id, {});
    await RiderPickupService.confirm(driver(r1), job.id, { itemCount: 1, confirmation: "signature", signature: SIGNATURE });

    await refused(DispatchJobService.reassign(managerA, scopeOf(managerA), job.id, { riderId: r2.id, reason: "x" }), 409);
    await refused(DispatchJobService.cancel(managerA, scopeOf(managerA), job.id, { reason: "x" }), 409);
  });

  it("cancels a waiting or assigned job and takes it off the rider", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);
    await refused(DispatchJobService.cancel(managerA, scopeOf(managerA), job.id, {}), 400);
    expect(await DispatchJobService.cancel(managerA, scopeOf(managerA), job.id, { reason: "customer cancelled" })).toEqual({ status: "cancelled" });
    expect(state.assignments.filter((a) => a.activeJobId)).toHaveLength(0);
    await refused(DispatchJobService.cancel(managerA, scopeOf(managerA), job.id, { reason: "again" }), 409);
    await refused(RiderJobService.start(driver(rider), job.id, {}), 409);
    const events = (await DispatchJobService.timeline(null, job.id)).events;
    expect(events.at(-1)).toMatchObject({ status: "cancelled", by: "Meera Nair", note: "customer cancelled" });
  });

  it("edits a slot, address or priority only until the rider sets off, and never takes unknown fields", async () => {
    const rider = onShiftRider();
    const job = await newJob();
    await assignTo(job.id, rider);

    const updated = await DispatchJobService.update(managerA, scopeOf(managerA), job.id, { priority: "express", notes: "ring twice", address: { line1: "9 Brigade Rd", pincode: "560025" }, riderId: "00000000-0000-4000-8000-0000000ffff9", status: "delivered" });
    expect(updated).toMatchObject({ priority: "express", notes: "ring twice", riderId: rider.id, status: "assigned" });
    expect((updated as any).address.line1).toBe("9 Brigade Rd");
    await refused(DispatchJobService.update(managerA, scopeOf(managerA), job.id, {}), 400, /at least one/);
    await refused(DispatchJobService.update(managerA, scopeOf(managerA), job.id, { priority: "urgent" }), 400);
    await refused(DispatchJobService.update(managerA, scopeOf(managerA), job.id, { slotFrom: "2026-10-02T10:00:00Z", slotTo: "2026-10-02T09:00:00Z" }), 400);

    await RiderJobService.start(driver(rider), job.id, {});
    await refused(DispatchJobService.update(managerA, scopeOf(managerA), job.id, { notes: "late edit" }), 409, /no longer be edited/);
  });

  it("a changed address is looked up again; without Maps its old coordinates are dropped", async () => {
    const job = await newJob({ address: { line1: "old", latitude: 1.5, longitude: 2.5 } });
    const updated = await DispatchJobService.update(managerA, scopeOf(managerA), job.id, { address: { line1: "new place" } });
    expect((updated as any).address.latitude).toBeNull();
  });
});

// ================================================================== auto-assign
describe("auto-assign", () => {
  it("spreads waiting jobs over the available riders, fewest jobs first", async () => {
    const busy = onShiftRider({ lastLatitude: 12.97, lastLongitude: 77.59, lastLocationAt: new Date() });
    const free = onShiftRider({ phone: "+919800000081", lastLatitude: 12.97, lastLongitude: 77.59, lastLocationAt: new Date() });
    for (let i = 0; i < 3; i++) seed.job({ riderId: busy.id, status: "assigned" });
    const jobs = [await newJob(), await newJob(), await newJob()];

    const result = await DispatchJobService.autoAssign(managerA, scopeOf(managerA), { storeId: STORE_A });

    expect(result).toEqual({ assigned: 3, unassigned: 0 });
    for (const job of jobs) expect((state.jobs.find((j) => j.id === job.id) as any).riderId).toBe(free.id);
    expect(state.assignments.filter((a) => a.activeJobId && jobs.some((j) => j.id === a.jobId))).toHaveLength(3);
  });

  it("gives express jobs first pick when riders are scarce, and leaves the rest waiting", async () => {
    const rider = onShiftRider();
    for (let i = 0; i < 14; i++) seed.job({ riderId: rider.id, status: "assigned" });
    const normal = await newJob();
    const express = await newJob({ priority: "express" });

    const result = await DispatchJobService.autoAssign(managerA, scopeOf(managerA), { storeId: STORE_A });

    expect(result).toEqual({ assigned: 1, unassigned: 1 });
    expect((state.jobs.find((j) => j.id === express.id) as any).riderId).toBe(rider.id);
    expect((state.jobs.find((j) => j.id === normal.id) as any).status).toBe("pending");
  });

  it("ignores riders who are off shift, unavailable, suspended or uninsured", async () => {
    seed.rider({ phone: "+919800000091" }); // no shift
    onShiftRider({ available: false, phone: "+919800000092" });
    onShiftRider({ status: "suspended", phone: "+919800000093" });
    onShiftRider({ insuranceExpiry: new Date(Date.now() - 86_400_000), phone: "+919800000094" });
    await newJob();
    expect(await DispatchJobService.autoAssign(managerA, scopeOf(managerA), { storeId: STORE_A })).toEqual({ assigned: 0, unassigned: 1 });
  });

  it("two runs at once never give a job to two riders", async () => {
    const riders = [onShiftRider(), onShiftRider({ phone: "+919800000095" }), onShiftRider({ phone: "+919800000096" })];
    const jobs = [];
    for (let i = 0; i < 6; i++) jobs.push(await newJob());

    const [a, b] = await Promise.all([
      DispatchJobService.autoAssign(managerA, scopeOf(managerA), { storeId: STORE_A }),
      DispatchJobService.autoAssign(staffA, scopeOf(staffA), { storeId: STORE_A }),
    ]);

    expect(a.assigned + b.assigned).toBe(6);
    for (const job of jobs) {
      expect(state.assignments.filter((x) => x.jobId === job.id && x.activeJobId)).toHaveLength(1);
      expect(riders.map((r) => r.id)).toContain((state.jobs.find((j) => j.id === job.id) as any).riderId);
    }
  });

  it("requires a store", async () => {
    await refused(DispatchJobService.autoAssign(managerA, scopeOf(managerA), {}), 400, /storeId/);
  });
});

// ===================================================================== routes & ETA
describe("routes and drive times with Maps", () => {
  const located = (riderId: string, latitude: number, longitude: number, extra: Record<string, unknown> = {}) =>
    seed.job({ riderId, status: "assigned", latitude, longitude, ...extra }) as any;

  it("adds ETAs to a rider's job list when Maps answers, and nothing breaks when it does not", async () => {
    const rider = onShiftRider({ lastLatitude: 12.9, lastLongitude: 77.5, lastLocationAt: new Date() });
    const a = located(rider.id, 12.91, 77.51, { sequence: 1 });
    const b = located(rider.id, 12.95, 77.55, { sequence: 2 });
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    (MapsClient.getRoute as jest.Mock).mockResolvedValue({
      legs: [{ distanceMeters: 2000, durationSeconds: 540 }, { distanceMeters: 3000, durationSeconds: 600 }],
      waypointOrder: [],
    });

    const listed = await RiderJobService.list(driver(rider), {});
    expect(listed.items.map((j: any) => [j.id, j.etaMinutes])).toEqual([[a.id, 9], [b.id, 19]]);
    expect(await RiderJobService.route(driver(rider), {})).toMatchObject({ totalDistanceKm: 5, stops: [{ jobId: a.id, etaMinutes: 9 }, { jobId: b.id, etaMinutes: 19 }] });

    (MapsClient.getRoute as jest.Mock).mockRejectedValue(new CustomException("Location lookup is unavailable right now.", 503));
    const degraded = await RiderJobService.list(driver(rider), {});
    expect(degraded.items.map((j: any) => j.etaMinutes)).toEqual([null, null]);
    expect((await RiderJobService.route(driver(rider), {})).stops).toHaveLength(2);
  });

  it("skips Maps when the rider's position is unknown", async () => {
    const rider = onShiftRider();
    located(rider.id, 12.91, 77.51);
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    await RiderJobService.list(driver(rider), {});
    expect(MapsClient.getRoute).not.toHaveBeenCalled();
  });

  it("re-plans a rider's day: Google's order is saved as the route sequence", async () => {
    const rider = onShiftRider({ lastLatitude: 12.9, lastLongitude: 77.5, lastLocationAt: new Date() });
    const far = located(rider.id, 13.1, 77.7, { sequence: 1 });
    const near = located(rider.id, 12.91, 77.51, { sequence: 2 });
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    (MapsClient.getRoute as jest.Mock).mockResolvedValue({
      legs: [{ distanceMeters: 1500, durationSeconds: 300 }, { distanceMeters: 20_000, durationSeconds: 1800 }, { distanceMeters: 21_000, durationSeconds: 1900 }],
      waypointOrder: [1, 0],
    });
    const date = new Date().toISOString().slice(0, 10);

    const plan = await DispatchJobService.optimizeRoute(managerA, scopeOf(managerA), { riderId: rider.id, date: istToday() });

    expect(plan.stops.map((s: any) => [s.jobId, s.sequence])).toEqual([[near.id, 1], [far.id, 2]]);
    expect(plan.totalDistanceKm).toBe(21.5); // the leg back to the start is not counted
    expect((state.jobs.find((j) => j.id === near.id) as any).sequence).toBe(1);
    // Round trip from the rider to every stop and back, optimised.
    const [points, options] = (MapsClient.getRoute as jest.Mock).mock.calls[0];
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual(points[3]);
    expect(options).toEqual({ optimize: true });
    void date;
  });

  it("falls back to slot order when Maps is unavailable", async () => {
    const rider = onShiftRider({ lastLatitude: 12.9, lastLongitude: 77.5, lastLocationAt: new Date() });
    const later = located(rider.id, 12.95, 77.55, { slotFrom: new Date(Date.now() + 3_600_000) });
    const earlier = located(rider.id, 13.05, 77.65, { slotFrom: new Date(Date.now() - 3_600_000) });
    (MapsClient.isConfigured as jest.Mock).mockReturnValue(true);
    (MapsClient.getRoute as jest.Mock).mockRejectedValue(new CustomException("down", 503));

    const plan = await DispatchJobService.optimizeRoute(managerA, scopeOf(managerA), { riderId: rider.id, date: istToday() });

    expect(plan.stops.map((s: any) => s.jobId)).toEqual([earlier.id, later.id]);
    expect(plan.stops.every((s: any) => s.etaMinutes === null)).toBe(true);
  });

  it("a store's dispatcher re-plans only their own store's jobs", async () => {
    const rider = onShiftRider();
    const mine = located(rider.id, 12.9, 77.5, { storeId: STORE_A });
    located(rider.id, 12.8, 77.4, { storeId: STORE_B });
    const plan = await DispatchJobService.optimizeRoute(managerA, scopeOf(managerA), { riderId: rider.id, date: istToday() });
    expect(plan.stops.map((s: any) => s.jobId)).toEqual([mine.id]);
    await refused(DispatchJobService.optimizeRoute(managerA, scopeOf(managerA), { riderId: rider.id }), 400, /date/);
  });

  it("summarises routes per rider and day within the caller's store", async () => {
    const rider = onShiftRider();
    located(rider.id, 12.9, 77.5, { storeId: STORE_A, distanceMeters: 2000 });
    located(rider.id, 12.8, 77.4, { storeId: STORE_B, distanceMeters: 9000 });
    const routes = await DispatchJobService.listRoutes(scopeOf(managerA), {});
    expect(routes.routes).toEqual([{ riderId: rider.id, date: istToday(), stops: 1, distanceKm: 2 }]);
    expect((await DispatchJobService.listRoutes(scopeOf(admin), {})).routes[0].stops).toBe(2);
  });
});

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

// =================================================================== pagination
describe("pagination", () => {
  it("caps the page size, defaults it, and refuses nonsense", async () => {
    for (let i = 0; i < 3; i++) await newJob();
    expect(await DispatchJobService.list(null, {})).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect((await DispatchJobService.list(null, { limit: "500" })).limit).toBe(100);
    const second = await DispatchJobService.list(null, { page: "2", limit: "2" });
    expect(second.items).toHaveLength(1);
    await refused(DispatchJobService.list(null, { page: "0" }), 400);
    await refused(DispatchJobService.list(null, { limit: "abc" }), 400);
    await refused(DispatchJobService.list(null, { status: "teleported" }), 400);
    await refused(DispatchJobService.list(null, { date: "yesterday" }), 400);
  });
});

// ================================================================ rider read models
describe("rider earnings, ratings and the shift summary", () => {
  it("adds up what a rider earned from the ledger, in rupees", async () => {
    const rider = onShiftRider();
    const at = new Date();
    state.ledger.push(
      { id: "1", riderId: rider.id, kind: "job_base", amountPaise: 4500, createdAt: at },
      { id: "2", riderId: rider.id, kind: "job_express", amountPaise: 1000, createdAt: at },
      { id: "3", riderId: rider.id, kind: "penalty", amountPaise: -500, createdAt: at },
      { id: "4", riderId: rider.id, kind: "payout", amountPaise: 2000, createdAt: at }
    );
    expect(await RiderEarningsService.earnings(driver(rider), {})).toMatchObject({ base: 45, incentives: 5, total: 50, paid: 20, due: 30 });
    await refused(RiderEarningsService.earnings(driver(rider), { from: "2026-01-01", to: "2026-12-31" }), 400, /at most/);
  });

  it("averages ratings and lists the recent ones", async () => {
    const rider = onShiftRider();
    const job = seed.job({ riderId: rider.id, status: "delivered" });
    await InternalJobService.recordRating({ jobId: job.id, rating: 5, comment: "quick" });
    const second = seed.job({ riderId: rider.id, status: "delivered" });
    await InternalJobService.recordRating({ jobId: second.id, rating: 4 });
    expect(await RiderEarningsService.ratings(driver(rider), {})).toMatchObject({ average: 4.5, count: 2 });
  });

  it("accepts one rating per finished job", async () => {
    const rider = onShiftRider();
    const done = seed.job({ riderId: rider.id, status: "delivered" });
    const open = seed.job({ riderId: rider.id, status: "assigned" });
    expect(await InternalJobService.recordRating({ jobId: done.id, rating: 5 })).toEqual({ recorded: true });
    expect(await InternalJobService.recordRating({ jobId: done.id, rating: 1 })).toEqual({ recorded: false });
    await refused(InternalJobService.recordRating({ jobId: open.id, rating: 5 }), 409);
    await refused(InternalJobService.recordRating({ jobId: done.id, rating: 6 }), 400);
  });

  it("summarises a day's shift", async () => {
    const rider = onShiftRider();
    const summary = await RiderShiftService.summary(driver(rider), {});
    expect(summary).toMatchObject({ jobsCompleted: 0, distanceKm: 0, earnings: 0 });
    expect(summary.hoursOnShift).toBeGreaterThanOrEqual(0);
    await refused(RiderShiftService.summary(driver(rider), { date: "nope" }), 400);
  });
});

describe("dispatch rider views", () => {
  it("lists riders with their job counts, filtered and paged", async () => {
    const busy = onShiftRider({ name: "Busy", phone: "+919800000101" });
    onShiftRider({ name: "Free", phone: "+919800000102", available: false });
    seed.job({ riderId: busy.id, status: "en_route" });
    const all = await DispatchRiderService.list({});
    expect(all.items.map((r: any) => [r.name, r.activeJobs])).toEqual([["Busy", 1], ["Free", 0]]);
    expect((await DispatchRiderService.list({ available: "true" })).items.map((r: any) => r.name)).toEqual(["Busy"]);
    await refused(DispatchRiderService.list({ available: "maybe" }), 400);
    await refused(DispatchRiderService.list({ status: "retired" }), 400);
  });

  it("offers only riders who can take a job now, least loaded and nearest first", async () => {
    const near = onShiftRider({ name: "Near", phone: "+919800000111", lastLatitude: 12.91, lastLongitude: 77.51, lastLocationAt: new Date() });
    const far = onShiftRider({ name: "Far", phone: "+919800000112", lastLatitude: 13.2, lastLongitude: 77.8, lastLocationAt: new Date() });
    onShiftRider({ name: "Suspended", phone: "+919800000113", status: "suspended" });
    seed.job({ latitude: 12.9, longitude: 77.5 });

    const { riders } = await DispatchRiderService.available(scopeOf(managerA), { storeId: STORE_A });

    expect(riders.map((r: any) => r.name)).toEqual(["Near", "Far"]);
    expect(riders[0].distanceKm).toBeLessThan(riders[1].distanceKm);
    expect(near.id).not.toBe(far.id);
    await refused(DispatchRiderService.available(scopeOf(managerA), {}), 400, /storeId/);
    await refused(DispatchRiderService.available(scopeOf(managerA), { storeId: STORE_B }), 404);
  });

  it("shares a rider's location only while they are on shift", async () => {
    const rider = seed.rider({ lastLatitude: 12.9, lastLongitude: 77.5, lastLocationAt: new Date() });
    await refused(DispatchRiderService.location(rider.id), 404);
    seed.shift(rider.id);
    expect(await DispatchRiderService.location(rider.id)).toMatchObject({ latitude: 12.9, longitude: 77.5 });
    await refused(DispatchRiderService.location("00000000-0000-4000-8000-0000000fff10"), 404);
    await refused(DispatchRiderService.location("junk"), 404);
  });
});

describe("a rider's shift", () => {
  it("reports on a rider's day and ends with the totals, bonus included", async () => {
    const rider = seed.rider();
    const started = await RiderShiftService.startShift(driver(rider), { vehicleChecked: true, latitude: 12.9, longitude: 77.5 });
    for (let i = 0; i < 10; i++) {
      seed.job({ riderId: rider.id, status: "delivered", shiftId: started.shiftId, completedAt: new Date(), distanceMeters: 1000, type: "delivery" });
    }
    const ended = await RiderShiftService.endShift(driver(rider), {});
    expect(ended).toEqual({ jobsCompleted: 10, distanceKm: 10, earnings: 100 });
    expect(state.ledger.map((l) => l.kind)).toEqual(["shift_bonus"]);
    expect((state.riders.find((r) => r.id === rider.id) as any).available).toBe(false);
    await refused(RiderShiftService.endShift(driver(rider), {}), 409, /no shift/);
  });

  it("will not end while garments are still in the rider's hands", async () => {
    const rider = onShiftRider();
    seed.job({ riderId: rider.id, status: "picked_up" });
    await refused(RiderShiftService.endShift(driver(rider), {}), 409, /Hand over/);
    await refused(RiderShiftService.endShift(driver(rider), { odometerKm: -1 }), 400);
  });
});
