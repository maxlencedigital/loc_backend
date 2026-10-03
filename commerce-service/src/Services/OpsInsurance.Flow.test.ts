import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// The Query modules are replaced by one in-memory database; services, validation, the claim
// state machine, derived policy status and store scoping are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryOps.js").storeQuery }));
jest.mock("../Queries/OpsPolicy.Query.js", () => ({ OpsPolicyQuery: require("../Testing/InMemoryOps.js").policyQuery }));
jest.mock("../Queries/OpsClaim.Query.js", () => ({ OpsClaimQuery: require("../Testing/InMemoryOps.js").claimQuery }));

import { reset, seed, state } from "../Testing/InMemoryOps.js";
import { addDays, todayIst } from "../Utils/OpsDates.js";
import { OpsClaimService as Claims } from "./OpsClaim.Service.js";
import { OpsPolicyService as Policies } from "./OpsPolicy.Service.js";

const actor = (role: UserRole, storeId: string | null = null): RequestUser => ({ id: `${role}-${storeId ?? "all"}`, role, storeId, scopeStoreId: null, name: null });
const scopeOf = (user: RequestUser) => resolveStoreScope({ user } as IdentifiedRequest);

const today = todayIst();
let storeA: any;
let storeB: any;
let admin: RequestUser;
let hr: RequestUser;
let managerA: RequestUser;
let managerB: RequestUser;

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
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  storeA = seed.store();
  storeB = seed.store();
  admin = actor("admin");
  hr = actor("hr");
  managerA = actor("manager", storeA.id);
  managerB = actor("manager", storeB.id);
});
afterEach(() => errorSpy.mockRestore());

let counter = 0;
const policy = (extra: Record<string, unknown> = {}) =>
  Policies.create(admin, {
    type: "property",
    insurer: "New India Assurance",
    policyNumber: `POL-${++counter}`,
    coverageAmount: 5_000_000,
    premium: 40_000,
    startDate: addDays(today, -100),
    endDate: addDays(today, 200),
    appliesTo: { storeIds: [storeA.id] },
    ...extra,
  });
const claim = (policyId: string, extra: Record<string, unknown> = {}, key?: string, user = admin) =>
  Claims.create(user, { policyId, type: "fire", description: "Dryer fire", incidentDate: addDays(today, -5), claimAmount: 120_000, ...extra }, key);
const submitted = async (policyId: string) => {
  const c = await claim(policyId);
  return Claims.update(c.id, admin, { status: "submitted" });
};

describe("policies", () => {
  it("enforces one policy number per insurer, ignoring capitalisation", async () => {
    await policy({ policyNumber: "ab-1", insurer: "HDFC Ergo" });
    await refused(policy({ policyNumber: "AB-1", insurer: "hdfc  ergo" }), 409, /already has a policy/);
    expect((await policy({ policyNumber: "AB-1", insurer: "ICICI Lombard" })).policyNumber).toBe("AB-1");
  });

  it("validates the payload", async () => {
    await refused(policy({ type: "pet" }), 400);
    await refused(policy({ startDate: "2026-13-01" }), 400);
    await refused(policy({ startDate: addDays(today, 5), endDate: addDays(today, 1) }), 400);
    await refused(policy({ coverageAmount: -5 }), 400);
    await refused(policy({ premium: 10.005 }), 400);
    await refused(policy({ appliesTo: { storeIds: ["00000000-0000-4000-8000-000000000000"] } }), 400, /store/);
    await refused(policy({ appliesTo: { storeIds: "x" } }), 400);
    await refused(policy({ status: "expired" }), 400);
    await refused(policy({ insurer: "" }), 400);
    expect((await policy({ coverageAmount: 50_00_00_000 })).coverageAmount).toBe(50_00_00_000);
  });

  it("derives status from the end date and filters on it", async () => {
    const active = await policy({ endDate: addDays(today, 90) });
    const expiring = await policy({ endDate: addDays(today, 10) });
    const lastDay = await policy({ endDate: today });
    const expired = await policy({ endDate: addDays(today, -1) });
    expect([active.status, expiring.status, lastDay.status, expired.status]).toEqual(["active", "expiring", "expiring", "expired"]);
    const ids = async (status: string) => (await Policies.list(admin, null, { status })).items.map((p) => p.id).sort();
    expect(await ids("active")).toEqual([active.id]);
    expect(await ids("expiring")).toEqual([expiring.id, lastDay.id].sort());
    expect(await ids("expired")).toEqual([expired.id]);
    await Policies.update(active.id, admin, { status: "cancelled" });
    expect(await ids("cancelled")).toEqual([active.id]);
    expect(await ids("active")).toEqual([]);
    await refused(Policies.list(admin, null, { status: "soon" }), 400);
  });

  it("cancels, refuses edits while cancelled, and reinstates", async () => {
    const p = await policy();
    const cancelled = await Policies.update(p.id, admin, { status: "cancelled", reason: "Sold the store" });
    expect(cancelled.status).toBe("cancelled");
    await refused(Policies.update(p.id, admin, { status: "cancelled" }), 409);
    await refused(Policies.update(p.id, admin, { covers: "x" }), 409, /Reinstate/);
    expect((await Policies.update(p.id, admin, { status: "active" })).status).toBe("active");
    expect((await Policies.update(p.id, admin, { covers: "Fire and theft", endDate: addDays(today, 300) })).covers).toBe("Fire and theft");
    await refused(Policies.update(p.id, admin, { endDate: addDays(today, -200) }), 400);
    await refused(Policies.update(p.id, admin, { status: "expired" }), 400);
  });

  it("limits a store manager to their own store's policies and hides who is insured", async () => {
    const forA = await policy({ appliesTo: { storeIds: [storeA.id], employeeIds: ["11111111-1111-4111-8111-111111111111"] } });
    const forB = await policy({ appliesTo: { storeIds: [storeB.id] } });
    const companyWide = await policy({});
    await Policies.update(companyWide.id, admin, { appliesTo: { storeIds: [] } });
    expect((await Policies.list(managerA, scopeOf(managerA), {})).items.map((p) => p.id)).toEqual([forA.id]);
    expect((await Policies.list(hr, null, {})).total).toBe(3);
    await refused(Policies.getById(forB.id, managerA, scopeOf(managerA)), 404);
    await refused(Policies.getById(companyWide.id, managerA, scopeOf(managerA)), 404);
    const seen = await Policies.getById(forA.id, managerA, scopeOf(managerA));
    expect(seen.appliesTo).toMatchObject({ employeeIds: [], employeeCount: 1 });
    expect((await Policies.getById(forA.id, hr, null)).appliesTo.employeeIds).toHaveLength(1);
    expect((await Policies.list(managerA, scopeOf(managerA), { storeId: storeB.id })).total).toBe(0);
    await refused(Policies.getById("not-an-id", admin, null), 404);
  });

  it("renews by extending the period, keeping a history row, and refuses bad renewals", async () => {
    const p = await policy({ endDate: addDays(today, 20), policyNumber: "R-1" });
    await refused(Policies.renew(p.id, admin, { newEndDate: addDays(today, 20) }), 400, /after/);
    await refused(Policies.renew(p.id, admin, { newEndDate: addDays(today, 3000) }), 400);
    await refused(Policies.renew(p.id, admin, {}), 400);
    const renewed = await Policies.renew(p.id, admin, { newEndDate: addDays(today, 385), premium: 45_000, policyNumber: "r-2" });
    expect([renewed.endDate, renewed.policyNumber, renewed.premium, renewed.status]).toEqual([addDays(today, 385), "R-2", 45_000, "active"]);
    expect(renewed.renewals).toEqual([expect.objectContaining({ previousEndDate: addDays(today, 20), previousPolicyNumber: "R-1", newPolicyNumber: "R-2" })]);
    await policy({ policyNumber: "TAKEN" });
    await refused(Policies.renew(p.id, admin, { newEndDate: addDays(today, 500), policyNumber: "TAKEN" }), 409);
    await Policies.update(p.id, admin, { status: "cancelled" });
    await refused(Policies.renew(p.id, admin, { newEndDate: addDays(today, 500) }), 409, /cancelled/);
    const lapsed = await policy({ endDate: addDays(today, -40) });
    await refused(Policies.renew(lapsed.id, admin, { newEndDate: addDays(today, -10) }), 400);
    expect((await Policies.renew(lapsed.id, admin, { newEndDate: addDays(today, 30) })).status).toBe("expiring");
  });

  it("two simultaneous renewals extend the period once", async () => {
    const p = await policy({ endDate: addDays(today, 20) });
    const results = await Promise.allSettled([Policies.renew(p.id, admin, { newEndDate: addDays(today, 385) }), Policies.renew(p.id, admin, { newEndDate: addDays(today, 385) })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.renewals).toHaveLength(1);
  });

  it("lists renewals due soon with days left, bounded and paged", async () => {
    await policy({ endDate: addDays(today, 15) });
    await policy({ endDate: addDays(today, 59) });
    await policy({ endDate: addDays(today, 61) });
    await policy({ endDate: addDays(today, -5) });
    await policy({ endDate: addDays(today, -45) });
    const cancelled = await policy({ endDate: addDays(today, 5) });
    await Policies.update(cancelled.id, admin, { status: "cancelled" });
    const due = await Policies.renewals(null, {});
    expect(due.renewals.map((r) => r.daysLeft)).toEqual([-5, 15, 59]);
    expect((await Policies.renewals(null, { withinDays: "20" })).renewals).toHaveLength(2);
    expect((await Policies.renewals(null, { limit: "1" })).total).toBe(3);
    await refused(Policies.renewals(null, { withinDays: "0" }), 400);
    await refused(Policies.renewals(null, { withinDays: "9999" }), 400);
    expect((await Policies.renewals(scopeOf(managerB), {})).total).toBe(0);
  });

  it("attaches https document references up to the limit", async () => {
    const p = await policy();
    const withDoc = await Policies.attachDocument(p.id, admin, { url: "https://files.test/policy.pdf", name: "Policy" });
    expect(withDoc.documents).toHaveLength(1);
    await refused(Policies.attachDocument(p.id, admin, { url: "ftp://files.test/x" }), 400);
    await refused(Policies.attachDocument(p.id, admin, { url: "https://files.test/x", sizeBytes: -1 }), 400);
    for (let i = 1; i < 10; i++) await Policies.attachDocument(p.id, admin, { url: `https://files.test/${i}` });
    await refused(Policies.attachDocument(p.id, admin, { url: "https://files.test/11" }), 409);
    await refused(Policies.attachDocument("0".repeat(8) + "-0000-4000-8000-000000000000", admin, { url: "https://files.test/x" }), 404);
  });

  it("says whether a rider's vehicle cover is in force", async () => {
    const rider = "22222222-2222-4222-8222-222222222222";
    expect(await Policies.riderCoverStatus(rider, null)).toEqual({ valid: false, expiresOn: null, policyNumber: null });
    const old = await policy({ type: "rider_vehicle", policyNumber: "RV-OLD", startDate: addDays(today, -400), endDate: addDays(today, -35), appliesTo: { storeIds: [storeA.id], employeeIds: [rider] } });
    expect(await Policies.riderCoverStatus(rider, null)).toEqual({ valid: false, expiresOn: old.endDate, policyNumber: "RV-OLD" });
    await policy({ type: "rider_vehicle", policyNumber: "RV-NEW", endDate: addDays(today, 100), appliesTo: { storeIds: [storeA.id], employeeIds: [rider] } });
    expect(await Policies.riderCoverStatus(rider, null)).toMatchObject({ valid: true, policyNumber: "RV-NEW" });
    expect((await Policies.riderCoverStatus(rider, scopeOf(managerB))).valid).toBe(false);
    expect((await Policies.riderCoverStatus(rider, scopeOf(managerA))).valid).toBe(true);
    await policy({ type: "property", policyNumber: "P-X", appliesTo: { employeeIds: ["33333333-3333-4333-8333-333333333333"] } });
    expect((await Policies.riderCoverStatus("33333333-3333-4333-8333-333333333333", null)).valid).toBe(false);
    await refused(Policies.riderCoverStatus("x", null), 404);
  });
});

describe("raising claims", () => {
  it("numbers a claim, takes the amount in paise and records the first history row", async () => {
    const p = await policy();
    const c = await claim(p.id, { claimAmount: 1234.56, type: "Water Damage", storeId: storeA.id });
    expect([c.number, c.status, c.claimAmount, c.type, c.raisedOn]).toEqual(["CLM-1001", "raised", 1234.56, "water_damage", today]);
    expect(c.timeline).toEqual([expect.objectContaining({ from: null, status: "raised" })]);
    expect(state.claims.get(c.id).claimAmountPaise).toBe(123456);
  });

  it("refuses claims the policy cannot honour", async () => {
    const p = await policy({ coverageAmount: 100_000 });
    await refused(claim(p.id, { claimAmount: 100_001 }), 400, /coverage/);
    await refused(claim(p.id, { incidentDate: addDays(today, 1) }), 400, /future/);
    await refused(claim(p.id, { incidentDate: addDays(today, -300) }), 400, /policy period/);
    await refused(claim(p.id, { storeId: storeB.id, claimAmount: 50_000 }), 400, /does not cover/);
    await refused(claim(p.id, { storeId: "00000000-0000-4000-8000-000000000000", claimAmount: 50_000 }), 400);
    await refused(claim(p.id, { type: "alien" }), 400);
    await refused(claim(p.id, { claimAmount: 0 }), 400);
    await refused(claim(p.id, { description: "" }), 400);
    await refused(claim(p.id, { incidentId: "x" }), 400);
    await refused(claim("00000000-0000-4000-8000-000000000000"), 404);
    await refused(Claims.create(admin, { type: "fire" }), 400);
    await Policies.update(p.id, admin, { status: "cancelled" });
    await refused(claim(p.id), 409, /cancelled/);
  });

  it("replays an Idempotency-Key and survives two simultaneous submissions", async () => {
    const p = await policy();
    const first = await claim(p.id, {}, "claim-key-1");
    expect((await claim(p.id, {}, "claim-key-1")).id).toBe(first.id);
    const [a, b] = await Promise.all([claim(p.id, {}, "claim-key-2"), claim(p.id, {}, "claim-key-2")]);
    expect(a.id).toBe(b.id);
    expect(state.claims.size).toBe(2);
    await refused(claim(p.id, {}, "x"), 400);
  });
});

describe("the claim state machine", () => {
  it("moves raised, submitted, under review, then settled, with a history row each time", async () => {
    const p = await policy();
    const c = await claim(p.id);
    const sub = await Claims.update(c.id, admin, { status: "submitted", insurerReference: "INS-77", note: "Sent by courier" });
    expect([sub.status, sub.insurerReference]).toEqual(["submitted", "INS-77"]);
    const review = await Claims.update(c.id, admin, { status: "under_review" });
    const done = await Claims.settle(c.id, admin, { outcome: "paid", note: "Cheque received" });
    expect([review.status, done.status, done.outcome, done.settledAmount]).toEqual(["under_review", "settled", "paid", 120_000]);
    expect(done.timeline.map((t) => [t.from, t.status, t.by])).toEqual([[null, "raised", "Admin"], ["raised", "submitted", "Admin"], ["submitted", "under_review", "Admin"], ["under_review", "settled", "Admin"]]);
    expect(done.timeline[1].note).toBe("Sent by courier");
  });

  it("refuses every move the machine does not allow", async () => {
    const p = await policy();
    const c = await claim(p.id);
    await refused(Claims.update(c.id, admin, { status: "under_review" }), 409);
    await refused(Claims.update(c.id, admin, { status: "raised" }), 409);
    await refused(Claims.update(c.id, admin, { status: "settled" }), 400, /settle/);
    await refused(Claims.update(c.id, admin, { status: "rejected" }), 400, /settle/);
    await refused(Claims.update(c.id, admin, {}), 400);
    await refused(Claims.update(c.id, admin, { status: "frozen" }), 400);
    await refused(Claims.settle(c.id, admin, { outcome: "paid" }), 409, /Submit/);
    await Claims.update(c.id, admin, { status: "submitted" });
    await refused(Claims.update(c.id, admin, { status: "submitted" }), 409);
    await Claims.settle(c.id, admin, { outcome: "rejected", note: "Not covered" });
    await refused(Claims.update(c.id, admin, { status: "under_review" }), 409, /rejected/);
    await refused(Claims.update(c.id, admin, { insurerReference: "late" }), 409);
    await refused(Claims.settle(c.id, admin, { outcome: "paid" }), 409);
    await refused(Claims.getById("nope"), 404);
  });

  it("checks settlement amounts against the amount claimed", async () => {
    const p = await policy();
    const c = await submitted(p.id);
    await refused(Claims.settle(c.id, admin, { outcome: "lost" }), 400);
    await refused(Claims.settle(c.id, admin, { outcome: "paid", amount: 120_001 }), 400);
    await refused(Claims.settle(c.id, admin, { outcome: "partially_paid" }), 400, /amount is required/);
    await refused(Claims.settle(c.id, admin, { outcome: "partially_paid", amount: 120_000 }), 400, /less/);
    await refused(Claims.settle(c.id, admin, { outcome: "rejected", amount: 5 }), 400);
    const done = await Claims.settle(c.id, admin, { outcome: "partially_paid", amount: 80_000.5 });
    expect([done.status, done.outcome, done.settledAmount]).toEqual(["settled", "partially_paid", 80_000.5]);
  });

  it("two simultaneous submissions make one transition", async () => {
    const p = await policy();
    const c = await claim(p.id);
    const results = await Promise.allSettled([Claims.update(c.id, admin, { status: "submitted" }), Claims.update(c.id, admin, { status: "submitted" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as CustomException).errorCode).toBe(409);
    expect(state.claims.get(c.id).events.filter((e: any) => e.toStatus === "submitted")).toHaveLength(1);
  });

  it("a paid and a rejected settlement racing leave exactly one outcome", async () => {
    const p = await policy();
    const c = await submitted(p.id);
    const results = await Promise.allSettled([Claims.settle(c.id, admin, { outcome: "paid" }), Claims.settle(c.id, admin, { outcome: "rejected" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const stored = state.claims.get(c.id);
    expect(stored.events.filter((e: any) => ["settled", "rejected"].includes(e.toStatus))).toHaveLength(1);
    expect(stored.outcome === "paid").toBe(stored.settledAmountPaise === 12_000_000);
  });

  it("attaches evidence up to the limit", async () => {
    const p = await policy();
    const c = await claim(p.id);
    const withDoc = await Claims.attachDocument(c.id, admin, { url: "https://files.test/photo.jpg", caption: "Burnt dryer" });
    expect(withDoc.documents[0]).toMatchObject({ caption: "Burnt dryer", attachedBy: admin.id });
    for (let i = 1; i < 20; i++) await Claims.attachDocument(c.id, admin, { url: `https://files.test/${i}.jpg` });
    await refused(Claims.attachDocument(c.id, admin, { url: "https://files.test/21.jpg" }), 409);
    await refused(Claims.attachDocument(c.id, admin, { url: "javascript:alert(1)" }), 400);
  });
});

describe("claim lists and history", () => {
  it("filters and pages claims", async () => {
    const p1 = await policy();
    const p2 = await policy();
    const a = await claim(p1.id);
    await claim(p2.id);
    await Claims.update(a.id, admin, { status: "submitted" });
    expect((await Claims.list({ status: "submitted" })).items.map((c) => c.id)).toEqual([a.id]);
    expect((await Claims.list({ policyId: p2.id })).total).toBe(1);
    expect((await Claims.list({ from: today, to: today })).total).toBe(2);
    expect((await Claims.list({ from: addDays(today, 1) })).total).toBe(0);
    expect((await Claims.list({ limit: "1", page: "2" })).items).toHaveLength(1);
    await refused(Claims.list({ policyId: "x" }), 400);
    await refused(Claims.list({ from: "yesterday" }), 400);
  });

  it("summarises what was claimed, paid and rejected, and how long decisions took", async () => {
    const p = await policy();
    const paid = await submitted(p.id);
    const rejected = await submitted(p.id);
    await claim(p.id, { type: "theft", claimAmount: 500 });
    state.claims.get(paid.id).raisedAt = new Date(Date.now() - 4 * 86_400_000);
    state.claims.get(rejected.id).raisedAt = new Date(Date.now() - 2 * 86_400_000);
    await Claims.settle(paid.id, admin, { outcome: "partially_paid", amount: 100_000 });
    await Claims.settle(rejected.id, admin, { outcome: "rejected" });
    const history = await Claims.history({});
    expect(history).toMatchObject({ totalClaimed: 240_500, totalPaid: 100_000, rejected: 1, averageDaysToSettle: 3 });
    expect(history.byType).toEqual({
      fire: { count: 2, claimed: 240_000, paid: 100_000, rejected: 1 },
      theft: { count: 1, claimed: 500, paid: 0, rejected: 0 },
    });
    expect((await Claims.history({ from: addDays(today, 1) })).averageDaysToSettle).toBeNull();
  });
});
