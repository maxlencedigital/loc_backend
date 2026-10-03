import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// The Query modules are replaced by one in-memory database; the services, the state machines
// and the validation below are the real code. Postgres-only rules (the partial unique indexes,
// the guarded UPDATE under real concurrency) are proven in the live run.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryOpsCompliance.js").storeQuery }));
jest.mock("../Queries/Compliance.Query.js", () => ({ ComplianceQuery: require("../Testing/InMemoryOpsCompliance.js").complianceQuery }));
jest.mock("../Queries/Audit.Query.js", () => ({ AuditQuery: require("../Testing/InMemoryOpsCompliance.js").auditQuery }));
jest.mock("../Queries/SafetyIncident.Query.js", () => ({ SafetyIncidentQuery: require("../Testing/InMemoryOpsCompliance.js").incidentQuery }));
jest.mock("../Queries/OpsActivity.Query.js", () => ({ OpsActivityQuery: require("../Testing/InMemoryOpsCompliance.js").activityQuery }));
jest.mock("../Queries/OpsCompliance.Db.js", () => ({ inTransaction: require("../Testing/InMemoryOpsCompliance.js").inTransaction }));
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { post: jest.fn() } }));
jest.mock("./OpsClaim.Service.js", () => ({ OpsClaimService: { create: jest.fn() } }));

import crypto from "crypto";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { reset, seedStore, state } from "../Testing/InMemoryOpsCompliance.js";
import { AuditService } from "./Audit.Service.js";
import { ComplianceService } from "./Compliance.Service.js";
import { IncidentService, reporterScope } from "./Incident.Service.js";
import { OpsClaimService } from "./OpsClaim.Service.js";
import { addDays, dayString, todayInIst } from "./OpsCompliance.Shared.js";

const uuid = () => crypto.randomUUID();
const post = ServiceClient.post as unknown as jest.Mock;
const claimCreate = OpsClaimService.create as unknown as jest.Mock;

let storeA: any;
let storeB: any;
let admin: RequestUser;
let hr: RequestUser;
let managerA: RequestUser;
let managerB: RequestUser;
let staffA: RequestUser;
let staffA2: RequestUser;
let driver: RequestUser;
const activeUsers = new Set<string>();

const actor = (role: UserRole, storeId: string | null = null): RequestUser => ({ id: uuid(), role, storeId, scopeStoreId: null, name: null });
const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);
const person = () => {
  const id = uuid();
  activeUsers.add(id);
  return id;
};
const day = (offset: number) => dayString(addDays(todayInIst(), offset));

beforeEach(() => {
  reset();
  activeUsers.clear();
  storeA = seedStore("BLR-IND");
  storeB = seedStore("BLR-KOR");
  admin = actor("admin");
  hr = actor("hr");
  managerA = actor("manager", storeA.id);
  managerB = actor("manager", storeB.id);
  staffA = actor("staff", storeA.id);
  staffA2 = actor("staff", storeA.id);
  driver = actor("driver", storeA.id);
  post.mockReset();
  post.mockImplementation(async (_service: string, _path: string, options: { body: { ids: string[] } }) => ({
    users: options.body.ids.filter((id) => activeUsers.has(id)).map((id) => ({ id, isActive: true })),
  }));
  claimCreate.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  let error: CustomException | undefined;
  try {
    await promise;
  } catch (caught) {
    error = caught as CustomException;
  }
  if (!error) throw new Error("expected the call to be rejected");
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
};

// ------------------------------------------------------------- compliance
const itemBody = (extra: Record<string, unknown> = {}) => ({ name: "Trade licence", type: "licence", expiresOn: day(200), ...extra });
const addItem = (user: RequestUser, extra: Record<string, unknown> = {}, scopeStoreId: string | null = null) =>
  ComplianceService.create(scopeOf(user, scopeStoreId), user, itemBody(extra));

describe("compliance items", () => {
  it("creates an item whose status is derived from the expiry date, ignoring a client status", async () => {
    const item = await addItem(admin, { storeId: storeA.id, authority: "BBMP", issuedOn: day(-100), status: "expired" });
    expect(item).toMatchObject({ name: "Trade licence", storeId: storeA.id, status: "valid", daysLeft: 200, authority: "BBMP" });
    expect(state.activity.map((a) => a.action)).toEqual(["created"]);
  });

  it("derives expired, expiring and valid at the day boundaries", async () => {
    const at = async (offset: number) => (await addItem(admin, { name: `n${offset}`, expiresOn: day(offset) })).status;
    expect([await at(-1), await at(0), await at(30), await at(31)]).toEqual(["expired", "expiring", "expiring", "valid"]);
  });

  it("refuses bad input: missing, malformed, impossible dates and an issue date after expiry", async () => {
    await refused(ComplianceService.create(null, admin, { type: "licence", expiresOn: day(5) }), 400, /name/);
    await refused(addItem(admin, { type: "banana" }), 400, /type/);
    await refused(addItem(admin, { expiresOn: "2026-02-31" }), 400, /expiresOn/);
    await refused(addItem(admin, { expiresOn: "tomorrow" }), 400, /expiresOn/);
    await refused(addItem(admin, { issuedOn: day(300) }), 400, /issuedOn/);
    await refused(addItem(admin, { name: "x".repeat(121) }), 400, /name/);
    expect(state.items.size).toBe(0);
  });

  it("checks the owner with the gateway and refuses an unknown one or a gateway outage, saving nothing", async () => {
    await refused(addItem(admin, { ownerId: uuid() }), 400, /ownerId/);
    post.mockRejectedValueOnce(new CustomException("A connected service is unavailable right now.", 503));
    await refused(addItem(admin, { ownerId: person() }), 503);
    expect(state.items.size).toBe(0);
    expect((await addItem(admin, { ownerId: person() })).ownerId).toBeTruthy();
  });

  it("allows one (store, type, name) and answers 409 for a duplicate, but not across stores", async () => {
    await addItem(admin, { storeId: storeA.id });
    await refused(addItem(admin, { storeId: storeA.id }), 409, /already exists/);
    await addItem(admin, { storeId: storeB.id });
    await addItem(admin, {});
    await refused(addItem(admin, {}), 409);
  });

  it("404s an unknown store and an unknown item", async () => {
    await refused(addItem(admin, { storeId: uuid() }), 404);
    await refused(ComplianceService.getById(uuid(), null), 404);
    await refused(ComplianceService.getById("not-a-uuid", null), 404);
  });

  it("lists paged, filtered by type and derived status, soonest expiry first", async () => {
    for (let i = 0; i < 5; i++) await addItem(admin, { name: `L${i}`, expiresOn: day(100 - i * 20) });
    await addItem(admin, { name: "cert", type: "certificate", expiresOn: day(-5) });
    const first = await ComplianceService.list(null, { page: "1", limit: "2" });
    expect(first).toMatchObject({ page: 1, limit: 2, total: 6 });
    expect(first.items.map((i) => i.name)).toEqual(["cert", "L4"]);
    expect((await ComplianceService.list(null, { status: "expired" })).items.map((i) => i.name)).toEqual(["cert"]);
    expect((await ComplianceService.list(null, { type: "licence", status: "expiring" })).total).toBe(1);
    await refused(ComplianceService.list(null, { limit: "0" }), 400);
    await refused(ComplianceService.list(null, { status: "soon" }), 400);
    expect((await ComplianceService.list(null, { limit: "5000" })).limit).toBe(100);
  });

  it("lists what is due, expired first, and bounds withinDays", async () => {
    await addItem(admin, { name: "late", expiresOn: day(-3) });
    await addItem(admin, { name: "soon", expiresOn: day(10) });
    await addItem(admin, { name: "far", expiresOn: day(120) });
    const due = await ComplianceService.expiring(null, {});
    expect(due.items.map((i) => [i.name, i.daysLeft])).toEqual([["late", -3], ["soon", 10]]);
    expect((await ComplianceService.expiring(null, { withinDays: "200" })).total).toBe(3);
    await refused(ComplianceService.expiring(null, { withinDays: "0" }), 400);
    await refused(ComplianceService.expiring(null, { withinDays: "366" }), 400);
    await refused(ComplianceService.expiring(null, { withinDays: "abc" }), 400);
  });

  it("summarises counts by derived status", async () => {
    await addItem(admin, { name: "a", expiresOn: day(-1) });
    await addItem(admin, { name: "b", expiresOn: day(5) });
    await addItem(admin, { name: "c", expiresOn: day(6) });
    await addItem(admin, { name: "d", expiresOn: day(90) });
    expect(await ComplianceService.summary(null, {})).toMatchObject({ total: 4, valid: 1, expiringSoon: 2, expired: 1 });
  });

  it("isolates stores: a manager sees their store and company-wide items, never another store's", async () => {
    const own = await addItem(admin, { name: "own", storeId: storeA.id });
    const other = await addItem(admin, { name: "other", storeId: storeB.id });
    const company = await addItem(admin, { name: "company" });
    const scope = scopeOf(managerA);
    expect((await ComplianceService.list(scope, {})).items.map((i) => i.name).sort()).toEqual(["company", "own"]);
    expect((await ComplianceService.getById(company.id, scope)).name).toBe("company");
    await refused(ComplianceService.getById(other.id, scope), 404);
    await refused(ComplianceService.update(other.id, scope, managerA, { name: "x" }), 404);
    await refused(ComplianceService.renew(other.id, scope, managerA, { newExpiresOn: day(400) }), 404);
    await refused(ComplianceService.getChecklist(other.id, scope), 404);
    await refused(ComplianceService.list(scope, { storeId: storeB.id }), 404);
    expect((await ComplianceService.list(scope, { storeId: storeA.id })).items.map((i) => i.id)).toEqual([own.id]);
    expect((await ComplianceService.summary(scope, {})).total).toBe(2);
    expect((await ComplianceService.list(null, {})).total).toBe(3);
  });

  it("an admin pinned to a store cannot reach another store's item", async () => {
    const other = await addItem(admin, { storeId: storeB.id });
    await refused(ComplianceService.getById(other.id, scopeOf(admin, storeA.id)), 404);
    await refused(addItem(admin, { storeId: storeB.id, name: "n" }, storeA.id), 404);
  });

  it("updates only whitelisted fields and records what changed", async () => {
    const item = await addItem(admin, { storeId: storeA.id });
    const updated = await ComplianceService.update(item.id, null, admin, {
      referenceNumber: "REF-2", createdBy: uuid(), id: uuid(), checklist: [{ title: "hack" }], authority: null,
    });
    expect(updated.referenceNumber).toBe("REF-2");
    expect(state.items.get(item.id)).toMatchObject({ createdBy: admin.id, checklist: [] });
    const row = state.activity.at(-1);
    expect(row).toMatchObject({ action: "updated", actorId: admin.id });
    expect(row.detail.changes).toHaveProperty("referenceNumber");
    await refused(ComplianceService.update(item.id, null, admin, {}), 400, /Nothing/);
    await refused(ComplianceService.update(item.id, null, admin, { expiresOn: "nope" }), 400);
    await refused(ComplianceService.update(item.id, null, admin, { issuedOn: day(999) }), 400);
  });

  it("renames into a duplicate only if free", async () => {
    await addItem(admin, { name: "A", storeId: storeA.id });
    const b = await addItem(admin, { name: "B", storeId: storeA.id });
    await refused(ComplianceService.update(b.id, null, admin, { name: "A" }), 409);
    expect(state.items.get(b.id).name).toBe("B");
  });

  it("renews with an append-only record, and refuses a date that is not later or is in the past", async () => {
    const item = await addItem(admin, { expiresOn: day(10), referenceNumber: "OLD" });
    const renewed = await ComplianceService.renew(item.id, null, admin, { newExpiresOn: day(375), referenceNumber: "NEW" });
    expect(renewed).toMatchObject({ expiresOn: day(375), referenceNumber: "NEW", status: "valid" });
    const detail = await ComplianceService.getById(item.id, null);
    expect(detail.renewals).toEqual([expect.objectContaining({ previousExpiresOn: day(10), newExpiresOn: day(375), previousReferenceNumber: "OLD" })]);
    await refused(ComplianceService.renew(item.id, null, admin, { newExpiresOn: day(375) }), 400, /later/);
    await refused(ComplianceService.renew(item.id, null, admin, { newExpiresOn: day(-2) }), 400, /past/);
    await refused(ComplianceService.renew(item.id, null, admin, {}), 400);
    expect(state.renewals).toHaveLength(1);
    expect(state.activity.filter((a) => a.action === "renewed")).toHaveLength(1);
  });

  it("two simultaneous renewals to the same date produce one renewal", async () => {
    const item = await addItem(admin, { expiresOn: day(10) });
    const results = await Promise.allSettled([
      ComplianceService.renew(item.id, null, admin, { newExpiresOn: day(400) }),
      ComplianceService.renew(item.id, null, hr, { newExpiresOn: day(400) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(state.renewals).toHaveLength(1);
  });

  it("replaces the checklist as a whole and bounds it", async () => {
    const item = await addItem(admin);
    await ComplianceService.setChecklist(item.id, null, admin, { items: [{ title: "Fire NOC", done: true }, { title: "Photo" }] });
    expect((await ComplianceService.getChecklist(item.id, null)).items).toEqual([{ title: "Fire NOC", done: true }, { title: "Photo", done: false }]);
    await ComplianceService.setChecklist(item.id, null, admin, { items: [] });
    expect((await ComplianceService.getChecklist(item.id, null)).items).toEqual([]);
    await refused(ComplianceService.setChecklist(item.id, null, admin, {}), 400, /list/);
    await refused(ComplianceService.setChecklist(item.id, null, admin, { items: [{ done: true }] }), 400, /title/);
    await refused(ComplianceService.setChecklist(item.id, null, admin, { items: [{ title: "a", done: "yes" }] }), 400, /done/);
    await refused(
      ComplianceService.setChecklist(item.id, null, admin, { items: Array.from({ length: 51 }, (_, i) => ({ title: `t${i}` })) }),
      400,
      /at most 50/
    );
  });

  it("attaches https document links only, with a cap", async () => {
    const item = await addItem(admin);
    const doc = await ComplianceService.addDocument(item.id, null, admin, { name: "Licence.pdf", url: "https://files.example.com/a.pdf" });
    expect(doc).toMatchObject({ name: "Licence.pdf", addedBy: admin.id });
    await refused(ComplianceService.addDocument(item.id, null, admin, { url: "http://files.example.com/a.pdf" }), 400, /https/);
    await refused(ComplianceService.addDocument(item.id, null, admin, { url: "https://user:pw@files.example.com/a" }), 400, /https/);
    await refused(ComplianceService.addDocument(item.id, null, admin, { url: "javascript:alert(1)" }), 400);
    await refused(ComplianceService.addDocument(item.id, null, admin, {}), 400, /https url/);
    for (let i = 1; i < 20; i++) await ComplianceService.addDocument(item.id, null, admin, { url: `https://files.example.com/${i}` });
    await refused(ComplianceService.addDocument(item.id, null, admin, { url: "https://files.example.com/21" }), 409, /at most 20/i);
  });
});

// ------------------------------------------------------------------ audits
const newAudit = (extra: Record<string, unknown> = {}, user: RequestUser = admin) =>
  AuditService.create(scopeOf(user), user, { type: "internal", title: "Q4 safety audit", scheduledFor: day(3), ...extra });
const startedAudit = async (extra: Record<string, unknown> = {}) => {
  const audit = await newAudit(extra);
  await AuditService.start(audit.id, null, admin);
  return audit;
};
const addFinding = (auditId: string, extra: Record<string, unknown> = {}) =>
  AuditService.createFinding(auditId, null, admin, { title: "Blocked exit", severity: "low", ...extra });

describe("audits", () => {
  it("schedules an audit and validates the plan", async () => {
    const audit = await newAudit({ storeId: storeA.id, auditor: "TUV", scope: "Fire safety" });
    expect(audit).toMatchObject({ status: "scheduled", openFindings: 0, storeId: storeA.id, auditor: "TUV" });
    await refused(AuditService.create(null, admin, { title: "x", scheduledFor: day(1) }), 400, /type/);
    await refused(newAudit({ type: "surprise" }), 400);
    await refused(newAudit({ scheduledFor: day(-1) }), 400, /past/);
    await refused(newAudit({ scheduledFor: "2026-13-01" }), 400);
    await refused(newAudit({ checklist: [{ title: "a", result: "maybe" }] }), 400, /result/);
    await refused(newAudit({ checklist: [{ title: "a", evidence: [{ url: "http://x.com/a" }] }] }), 400, /https/);
    await refused(newAudit({ storeId: uuid() }), 404);
  });

  it("moves scheduled to in_progress to completed and refuses every other step", async () => {
    const audit = await newAudit();
    await refused(AuditService.complete(audit.id, null, admin, {}), 409, /in progress/);
    expect((await AuditService.start(audit.id, null, admin)).status).toBe("in_progress");
    await refused(AuditService.start(audit.id, null, admin), 409);
    expect((await AuditService.complete(audit.id, null, admin, { summary: "All good" })).status).toBe("completed");
    await refused(AuditService.complete(audit.id, null, admin, {}), 409);
    await refused(AuditService.update(audit.id, null, admin, { title: "late edit" }), 409);
    await refused(AuditService.start(audit.id, null, admin), 409);
    const detail = await AuditService.getById(audit.id, null);
    expect(detail.history.map((h: any) => h.action)).toEqual(["created", "started", "completed"]);
    expect(detail).toMatchObject({ summary: "All good", status: "completed" });
  });

  it("two simultaneous starts: one wins, one is refused, one history row", async () => {
    const audit = await newAudit();
    const results = await Promise.allSettled([AuditService.start(audit.id, null, admin), AuditService.start(audit.id, null, hr)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(state.activity.filter((a) => a.action === "started")).toHaveLength(1);
  });

  it("changes the plan, and cancels only an audit with no findings", async () => {
    const audit = await newAudit();
    expect(await AuditService.update(audit.id, null, admin, { title: "Renamed", scheduledFor: day(9) })).toMatchObject({ title: "Renamed", scheduledFor: day(9) });
    await refused(AuditService.update(audit.id, null, admin, {}), 400, /Nothing/);
    await refused(AuditService.update(audit.id, null, admin, { status: "completed" }), 400);
    await refused(AuditService.update(audit.id, null, admin, { status: "cancelled" }), 400, /cancelReason/);
    expect((await AuditService.update(audit.id, null, admin, { status: "cancelled", cancelReason: "Auditor unavailable" })).status).toBe("cancelled");
    await refused(AuditService.start(audit.id, null, admin), 409);

    const busy = await startedAudit({ title: "busy" });
    await AuditService.update(busy.id, null, admin, { scheduledFor: undefined, title: "still ok" });
    await addFinding(busy.id);
    await refused(AuditService.update(busy.id, null, admin, { status: "cancelled", cancelReason: "no" }), 409, /findings/);
    await refused(AuditService.update(busy.id, null, admin, { scheduledFor: day(20) }), 409, /started/);
  });

  it("records findings only while the audit is in progress", async () => {
    const audit = await newAudit();
    await refused(addFinding(audit.id), 409, /in progress/);
    await AuditService.start(audit.id, null, admin);
    const finding = await addFinding(audit.id, { severity: "medium", description: "Exit blocked" });
    expect(finding).toMatchObject({ status: "open", severity: "medium", auditId: audit.id });
    await AuditService.complete(audit.id, null, admin, {});
    await refused(addFinding(audit.id), 409);
    await refused(addFinding(uuid()), 404);
  });

  it("validates a finding: severity, owner, due date", async () => {
    const audit = await startedAudit();
    await refused(AuditService.createFinding(audit.id, null, admin, { severity: "low" }), 400, /title/);
    await refused(addFinding(audit.id, { severity: "extreme" }), 400, /severity/);
    await refused(addFinding(audit.id, { ownerId: "nope" }), 400, /ownerId/);
    await refused(addFinding(audit.id, { ownerId: uuid() }), 400, /active user/);
    await refused(addFinding(audit.id, { dueDate: day(-1) }), 400, /past/);
    post.mockRejectedValueOnce(new CustomException("A connected service is unavailable right now.", 503));
    await refused(addFinding(audit.id, { ownerId: person() }), 503);
    expect(state.findings.size).toBe(0);
  });

  it("will not complete with an open critical finding unless waived with a stored reason", async () => {
    const audit = await startedAudit();
    const critical = await addFinding(audit.id, { severity: "critical", title: "Gas leak" });
    await refused(AuditService.complete(audit.id, null, admin, {}), 409, /critical/);
    expect(state.audits.get(audit.id).status).toBe("in_progress");
    const done = await AuditService.complete(audit.id, null, admin, { waiveCriticalReason: "Fixed on site, paperwork pending" });
    expect(done.status).toBe("completed");
    expect(state.audits.get(audit.id).waiverReason).toBe("Fixed on site, paperwork pending");
    expect(state.activity.find((a) => a.action === "completed").detail.waivedCriticalFindingIds).toEqual([critical.id]);
  });

  it("completes without a waiver once the critical finding is closed, and stores no waiver", async () => {
    const audit = await startedAudit();
    const critical = await addFinding(audit.id, { severity: "critical" });
    await AuditService.closeFinding(critical.id, null, admin, { correctiveAction: "Replaced valve", evidence: "https://x.example.com/p.jpg" });
    await AuditService.complete(audit.id, null, admin, { waiveCriticalReason: "not needed" });
    expect(state.audits.get(audit.id).waiverReason).toBeNull();
  });

  it("a critical finding recorded at the same moment as completion can never end up unwaived", async () => {
    const audit = await startedAudit();
    await Promise.allSettled([addFinding(audit.id, { severity: "critical" }), AuditService.complete(audit.id, null, admin, {})]);
    const completed = state.audits.get(audit.id).status === "completed";
    const criticalOpen = [...state.findings.values()].some((f) => f.severity === "critical" && f.status === "open");
    expect(completed && criticalOpen).toBe(false);
  });

  it("blocks completion while a checklist line has no result", async () => {
    const audit = await startedAudit({ checklist: [{ title: "Extinguishers", result: "pass" }, { title: "Exits" }] });
    await refused(AuditService.complete(audit.id, null, admin, {}), 409, /checklist/);
    await AuditService.update(audit.id, null, admin, {
      checklist: [{ title: "Extinguishers", result: "pass", evidence: [{ url: "https://x.example.com/e.jpg" }] }, { title: "Exits", result: "na" }],
    });
    expect((await AuditService.complete(audit.id, null, admin, {})).status).toBe("completed");
  });

  it("needs an owner and due date before a finding starts, and closed is final", async () => {
    const audit = await startedAudit();
    const finding = await addFinding(audit.id);
    await refused(AuditService.updateFinding(finding.id, null, admin, { status: "in_progress" }), 400, /owner and a due date/);
    const owner = person();
    const moved = await AuditService.updateFinding(finding.id, null, admin, { ownerId: owner, dueDate: day(7), status: "in_progress" });
    expect(moved).toMatchObject({ status: "in_progress", ownerId: owner, dueDate: day(7) });
    await refused(AuditService.updateFinding(finding.id, null, admin, { status: "closed" }), 400, /close action/);
    await refused(AuditService.updateFinding(finding.id, null, admin, {}), 400, /Nothing/);
    await refused(AuditService.updateFinding(finding.id, null, admin, { ownerId: uuid() }), 400);
    await refused(AuditService.updateFinding(finding.id, null, admin, { dueDate: day(-3) }), 400);
    await AuditService.closeFinding(finding.id, null, admin, { correctiveAction: "Cleared the exit" });
    await refused(AuditService.updateFinding(finding.id, null, admin, { dueDate: day(10) }), 409, /closed/);
    await refused(AuditService.closeFinding(finding.id, null, admin, { correctiveAction: "again" }), 409, /already closed/);
  });

  it("closing a high or critical finding needs evidence, and records who verified it", async () => {
    const audit = await startedAudit();
    const high = await addFinding(audit.id, { severity: "high" });
    await refused(AuditService.closeFinding(high.id, null, admin, {}), 400, /correctiveAction/);
    await refused(AuditService.closeFinding(high.id, null, admin, { correctiveAction: "Fixed" }), 400, /evidence/);
    const closed = await AuditService.closeFinding(high.id, null, hr, { correctiveAction: "Fixed", evidence: "Photo 12" });
    expect(closed).toMatchObject({ status: "closed", closedBy: hr.id, correctiveAction: "Fixed" });
  });

  it("two simultaneous closes of one finding: one wins and one history row", async () => {
    const audit = await startedAudit();
    const finding = await addFinding(audit.id);
    const results = await Promise.allSettled([
      AuditService.closeFinding(finding.id, null, admin, { correctiveAction: "a" }),
      AuditService.closeFinding(finding.id, null, hr, { correctiveAction: "b" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(state.activity.filter((a) => a.action === "closed" && a.entity === "audit_finding")).toHaveLength(1);
  });

  it("lists open findings by severity then due date, with filters, paging and days overdue", async () => {
    const audit = await startedAudit();
    const owner = person();
    await addFinding(audit.id, { title: "low-late", severity: "low", dueDate: day(0) });
    await addFinding(audit.id, { title: "crit-soon", severity: "critical", dueDate: day(5), ownerId: owner });
    await addFinding(audit.id, { title: "high-none", severity: "high" });
    const done = await addFinding(audit.id, { title: "closed", severity: "low" });
    await AuditService.closeFinding(done.id, null, admin, { correctiveAction: "ok" });
    const all = await AuditService.listOpenFindings(null, {});
    expect(all.findings.map((f) => f.title)).toEqual(["crit-soon", "high-none", "low-late"]);
    expect(all.total).toBe(3);
    expect((await AuditService.listOpenFindings(null, { severity: "high" })).findings).toHaveLength(1);
    expect((await AuditService.listOpenFindings(null, { ownerId: owner })).findings.map((f) => f.title)).toEqual(["crit-soon"]);
    expect((await AuditService.listOpenFindings(null, { page: "2", limit: "2" })).findings.map((f) => f.title)).toEqual(["low-late"]);
    state.findings.forEach((f) => f.title === "low-late" && (f.dueDate = addDays(todayInIst(), -4)));
    const overdue = await AuditService.listOpenFindings(null, { overdue: "true" });
    expect(overdue.findings.map((f) => [f.title, f.daysOverdue])).toEqual([["low-late", 4]]);
    await refused(AuditService.listOpenFindings(null, { overdue: "maybe" }), 400);
    await refused(AuditService.listOpenFindings(null, { severity: "huge" }), 400);
  });

  it("lists audits with their open-finding counts in one grouped lookup, paged and filtered", async () => {
    const a = await startedAudit({ title: "A", storeId: storeA.id });
    await newAudit({ title: "B", storeId: storeB.id, scheduledFor: day(10) });
    await addFinding(a.id);
    await addFinding(a.id);
    const list = await AuditService.list(null, {});
    expect(list.total).toBe(2);
    expect(list.items.find((i) => i.title === "A")?.openFindings).toBe(2);
    expect((await AuditService.list(null, { status: "in_progress" })).items.map((i) => i.title)).toEqual(["A"]);
    expect((await AuditService.list(null, { type: "external" })).total).toBe(0);
    expect((await AuditService.list(null, { limit: "1" })).items).toHaveLength(1);
    await refused(AuditService.list(null, { status: "done" }), 400);
  });

  it("isolates stores for audits and findings: managers cannot read, and another store is 404", async () => {
    const own = await startedAudit({ title: "own", storeId: storeA.id });
    const foreign = await startedAudit({ title: "foreign", storeId: storeB.id });
    const ownFinding = await addFinding(own.id);
    const foreignFinding = await addFinding(foreign.id);
    const scope = scopeOf(managerA);
    expect((await AuditService.list(scope, {})).items.map((i) => i.title)).toEqual(["own"]);
    await refused(AuditService.getById(foreign.id, scope), 404);
    await refused(AuditService.listFindings(foreign.id, scope, {}), 404);
    await refused(AuditService.closeFinding(foreignFinding.id, scope, managerA, { correctiveAction: "x" }), 404);
    await refused(AuditService.updateFinding(foreignFinding.id, scope, managerA, { dueDate: day(2) }), 404);
    await refused(AuditService.start(foreign.id, scope, managerA), 404);
    expect((await AuditService.listOpenFindings(scope, {})).findings.map((f) => f.id)).toEqual([ownFinding.id]);
    expect((await AuditService.listFindings(own.id, scope, {})).total).toBe(1);
    await refused(AuditService.list(scope, { storeId: storeB.id }), 404);
  });

  it("answers an auditor from the history: filters by person, entity and action, bounds the range", async () => {
    const audit = await startedAudit();
    await addFinding(audit.id);
    await ComplianceService.create(null, hr, itemBody());
    const all = await AuditService.evidence(null, {});
    expect(all.total).toBe(4);
    expect(all.entries[0]).toHaveProperty("entityId");
    expect((await AuditService.evidence(null, { userId: hr.id })).entries.map((e) => e.entity)).toEqual(["compliance_item"]);
    expect((await AuditService.evidence(null, { entity: "audit_finding" })).total).toBe(1);
    expect((await AuditService.evidence(null, { action: "started" })).total).toBe(1);
    expect((await AuditService.evidence(null, { from: day(0), to: day(0) })).total).toBe(4);
    await refused(AuditService.evidence(null, { from: day(1) }), 400);
    await refused(AuditService.evidence(null, { from: day(-400) }), 400, /at most 366/);
    await refused(AuditService.evidence(null, { from: day(5), to: day(1) }), 400);
    await refused(AuditService.evidence(null, { userId: "x" }), 400);
    expect((await AuditService.evidence(null, { limit: "2" })).entries).toHaveLength(2);
  });
});

// --------------------------------------------------------------- incidents
const report = (user: RequestUser, extra: Record<string, unknown> = {}, key?: string) =>
  IncidentService.report(
    user,
    reporterScope({ user } as IdentifiedRequest),
    { type: "injury", description: "Slipped on a wet floor", occurredAt: new Date().toISOString(), ...extra },
    key
  );
const incidentIn = async (user: RequestUser = staffA, extra: Record<string, unknown> = {}) => (await report(user, extra)).id;
const view = (id: string, scope: string | null = null) => IncidentService.getById(id, scope);
const assigned = async (id: string) => IncidentService.assign(id, null, admin, { assigneeId: person() });

describe("safety incidents", () => {
  it("lets staff, a rider and a manager report; the store comes from their account", async () => {
    const byStaff = await report(staffA);
    expect(byStaff).toMatchObject({ status: "open", severity: "high" });
    expect(state.incidents.get(byStaff.id)).toMatchObject({ storeId: storeA.id, reportedBy: staffA.id });
    expect(state.incidents.get((await report(driver, { type: "vehicle_accident" })).id)).toMatchObject({ storeId: storeA.id });
    expect((await report(managerA, { type: "near_miss" })).severity).toBe("low");
    expect((await report(hr, { storeId: storeB.id, severity: "critical" })).severity).toBe("critical");
    expect(state.incidents.get((await report(hr)).id).storeId).toBeNull();
  });

  it("refuses a store-bound reporter naming another store, even a rider", async () => {
    await refused(report(staffA, { storeId: storeB.id }), 404);
    await refused(report(driver, { storeId: storeB.id }), 404);
    expect((await report(staffA, { storeId: storeA.id })).id).toBeTruthy();
    expect(state.incidents.size).toBe(1);
  });

  it("validates the report", async () => {
    await refused(IncidentService.report(staffA, storeA.id, { description: "x", occurredAt: new Date().toISOString() }), 400, /type/);
    await refused(report(staffA, { type: "meteor" }), 400, /type/);
    await refused(report(staffA, { description: "  " }), 400, /description/);
    await refused(report(staffA, { description: "x".repeat(4001) }), 400, /description/);
    await refused(report(staffA, { occurredAt: "yesterday" }), 400, /occurredAt/);
    await refused(report(staffA, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }), 400, /future/);
    await refused(report(staffA, { occurredAt: "2001-01-01T00:00:00Z" }), 400, /long ago/);
    await refused(report(staffA, { severity: "extreme" }), 400, /severity/);
    await refused(report(staffA, { peopleInvolved: ["nope"] }), 400, /peopleInvolved/);
    await refused(report(staffA, { peopleInvolved: Array.from({ length: 21 }, () => uuid()) }), 400, /at most 20/);
    await refused(report(staffA, {}, "short"), 400, /Idempotency-Key/);
    expect(state.incidents.size).toBe(0);
  });

  it("returns the first incident when a report is retried with the same key, even concurrently", async () => {
    const first = await report(staffA, {}, "key-0000001");
    expect((await report(staffA, {}, "key-0000001")).id).toBe(first.id);
    const [a, b] = await Promise.all([report(staffA, {}, "key-0000002"), report(staffA, {}, "key-0000002")]);
    expect(a.id).toBe(b.id);
    expect(state.incidents.size).toBe(2);
    expect((await report(staffA2, {}, "key-0000001")).id).not.toBe(first.id);
  });

  it("shows managers their own store only, and managerB gets 404 for store A", async () => {
    const mine = await incidentIn(staffA);
    const foreign = (await report(actor("staff", storeB.id))).id;
    const scope = scopeOf(managerA);
    expect((await IncidentService.list(scope, {})).items.map((i) => i.id)).toEqual([mine]);
    expect((await view(mine, scope)).reportedBy).toBe(staffA.id);
    await refused(view(foreign, scope), 404);
    await refused(IncidentService.assign(foreign, scope, managerA, { assigneeId: person() }), 404);
    await refused(IncidentService.recordAction(foreign, scope, managerA, { action: "x" }), 404);
    await refused(IncidentService.escalate(foreign, scope, managerA, { reason: "x" }), 404);
    await refused(IncidentService.close(foreign, scope, managerA, { outcome: "x", preventiveMeasures: "y" }), 404);
    await refused(IncidentService.raiseClaim(foreign, scope, managerA, { policyId: uuid(), claimAmount: 10 }), 404);
    await refused(IncidentService.list(scope, { storeId: storeB.id }), 404);
    expect((await IncidentService.list(null, {})).total).toBe(2);
    expect((await IncidentService.list(scopeOf(managerB), {})).items.map((i) => i.id)).toEqual([foreign]);
    await refused(view("nope"), 404);
  });

  it("lists with filters and paging, newest first", async () => {
    await incidentIn(staffA, { type: "near_miss", occurredAt: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    await incidentIn(staffA, { type: "injury", severity: "critical" });
    await incidentIn(staffA, { type: "injury" });
    expect((await IncidentService.list(null, { type: "injury" })).total).toBe(2);
    expect((await IncidentService.list(null, { severity: "critical" })).total).toBe(1);
    expect((await IncidentService.list(null, { status: "closed" })).total).toBe(0);
    expect((await IncidentService.list(null, { from: day(-1) })).total).toBe(2);
    expect((await IncidentService.list(null, { to: day(-3) })).total).toBe(1);
    expect((await IncidentService.list(null, { limit: "1", page: "3" })).items).toHaveLength(1);
    await refused(IncidentService.list(null, { type: "meteor" }), 400);
    await refused(IncidentService.list(null, { from: "2026-02-30" }), 400);
  });

  it("walks open to assigned to in_progress to closed with one history row per change", async () => {
    const id = await incidentIn();
    expect((await assigned(id)).status).toBe("assigned");
    const acted = await IncidentService.recordAction(id, null, managerA, { action: "Mopped and signed", doneOn: day(0) });
    expect(acted.status).toBe("in_progress");
    const closed = await IncidentService.close(id, null, admin, { outcome: "Floor fixed", preventiveMeasures: "Anti-slip mats", rootCause: "Leak" });
    expect(closed).toMatchObject({ status: "closed", outcome: "Floor fixed", closedBy: admin.id, rootCause: "Leak" });
    expect(closed.timeline.map((t: any) => t.action)).toEqual(["reported", "assigned", "action_recorded", "closed"]);
    expect(closed.timeline.map((t: any) => [t.from, t.to])).toEqual([[null, "open"], ["open", "assigned"], ["assigned", "in_progress"], ["in_progress", "closed"]]);
  });

  it("refuses transitions the machine does not allow", async () => {
    const id = await incidentIn();
    await refused(IncidentService.close(id, null, admin, { outcome: "x", preventiveMeasures: "y" }), 409, /Assign/);
    await IncidentService.escalate(id, null, admin, { reason: "Serious" });
    await refused(IncidentService.escalate(id, null, admin, { reason: "again" }), 409, /already/);
    await IncidentService.close(id, null, admin, { outcome: "o", preventiveMeasures: "p" });
    await refused(IncidentService.escalate(id, null, admin, { reason: "x" }), 409, /closed/);
    await refused(IncidentService.assign(id, null, admin, { assigneeId: person() }), 409, /closed/);
    await refused(IncidentService.recordAction(id, null, admin, { action: "x" }), 409, /closed/);
    await refused(IncidentService.close(id, null, admin, { outcome: "o", preventiveMeasures: "p" }), 409, /closed/);
  });

  it("requires a root cause or outcome and preventive measures to close", async () => {
    const id = await incidentIn();
    await assigned(id);
    await refused(IncidentService.close(id, null, admin, { preventiveMeasures: "p" }), 400, /outcome/);
    await refused(IncidentService.close(id, null, admin, { outcome: "o" }), 400, /preventiveMeasures/);
    await refused(IncidentService.close(id, null, admin, { outcome: "o", preventiveMeasures: "  " }), 400);
    expect(state.incidents.get(id).status).toBe("assigned");
  });

  it("two simultaneous closes: one wins, the other is refused, one closed row", async () => {
    const id = await incidentIn();
    await assigned(id);
    const body = { outcome: "o", preventiveMeasures: "p" };
    const results = await Promise.allSettled([IncidentService.close(id, null, admin, body), IncidentService.close(id, null, hr, body)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(state.activity.filter((a) => a.action === "closed")).toHaveLength(1);
  });

  it("a stale change loses to a concurrent escalation instead of overwriting it", async () => {
    const id = await incidentIn();
    await assigned(id);
    const results = await Promise.allSettled([
      IncidentService.escalate(id, null, admin, { reason: "serious" }),
      IncidentService.close(id, null, hr, { outcome: "o", preventiveMeasures: "p" }),
    ]);
    const status = state.incidents.get(id).status;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(status === "closed" ? 2 : 1);
    expect(["escalated", "closed"]).toContain(status);
  });

  it("assigns only to an active user and survives no outage silently", async () => {
    const id = await incidentIn();
    await refused(IncidentService.assign(id, null, admin, { assigneeId: uuid() }), 400, /active user/);
    await refused(IncidentService.assign(id, null, admin, { assigneeId: "nope" }), 400);
    await refused(IncidentService.assign(id, null, admin, {}), 400);
    post.mockRejectedValueOnce(new CustomException("A connected service is unavailable right now.", 503));
    await refused(IncidentService.assign(id, null, admin, { assigneeId: person() }), 503);
    expect(state.incidents.get(id)).toMatchObject({ status: "open", assigneeId: null });
    const first = await assigned(id);
    const second = await assigned(id);
    expect(second.status).toBe("assigned");
    expect(second.timeline.map((t: any) => t.action)).toEqual(["reported", "assigned", "reassigned"]);
    expect(first.assigneeId).not.toBe(second.assigneeId);
  });

  it("lets severity rise freely, but lowering needs a reason and is recorded", async () => {
    const id = await incidentIn(staffA, { severity: "medium" });
    const raised = await IncidentService.recordAction(id, null, managerA, { action: "Called ambulance", severity: "critical" });
    expect(raised.severity).toBe("critical");
    await refused(IncidentService.recordAction(id, null, managerA, { action: "Re-assessed", severity: "low" }), 400, /severityReason/);
    expect(state.incidents.get(id).severity).toBe("critical");
    const lowered = await IncidentService.recordAction(id, null, managerA, { action: "Re-assessed", severity: "high", severityReason: "Doctor says minor" });
    expect(lowered.severity).toBe("high");
    const changes = lowered.timeline.filter((t: any) => t.action === "severity_changed").map((t: any) => t.detail);
    expect(changes).toEqual([
      { from: "medium", to: "critical", reason: null },
      { from: "critical", to: "high", reason: "Doctor says minor" },
    ]);
    await refused(IncidentService.recordAction(id, null, managerA, { action: "x", severity: "bogus" }), 400);
  });

  it("validates a recorded action and caps them at 50 per incident", async () => {
    const id = await incidentIn();
    await refused(IncidentService.recordAction(id, null, admin, {}), 400, /action/);
    await refused(IncidentService.recordAction(id, null, admin, { action: "x", doneOn: day(2) }), 400, /future/);
    await refused(IncidentService.recordAction(id, null, admin, { action: "x", doneBy: uuid() }), 400, /active user/);
    for (let i = 0; i < 50; i++) await IncidentService.recordAction(id, null, admin, { action: `a${i}` });
    await refused(IncidentService.recordAction(id, null, admin, { action: "one too many" }), 409, /at most 50/i);
    expect(state.incidents.get(id).actionCount).toBe(50);
  });

  it("lists escalated incidents with their actions in one go, and nothing else", async () => {
    const hot = await incidentIn(staffA, { type: "fire_risk" });
    const calm = await incidentIn();
    await IncidentService.recordAction(hot, null, admin, { action: "Evacuated" });
    await IncidentService.recordAction(hot, null, admin, { action: "Called fire brigade" });
    await IncidentService.escalate(hot, null, admin, { reason: "Fire risk" });
    await IncidentService.recordAction(calm, null, admin, { action: "Minor" });
    const result = await IncidentService.escalated(null, {});
    expect(result.incidents).toEqual([expect.objectContaining({ id: hot, actionsTaken: ["Evacuated", "Called fire brigade"], escalationReason: "Fire risk" })]);
    expect(result.total).toBe(1);
  });

  it("summarises totals, open, by type, by severity and repeat patterns", async () => {
    await incidentIn(staffA, { type: "injury" });
    await incidentIn(staffA, { type: "injury" });
    const closing = await incidentIn(staffA, { type: "near_miss" });
    await assigned(closing);
    await IncidentService.close(closing, null, admin, { outcome: "o", preventiveMeasures: "p" });
    await incidentIn(actor("staff", storeB.id), { type: "injury" });
    const summary = await IncidentService.summary(null, {});
    expect(summary).toMatchObject({ total: 4, open: 3, byType: { injury: 3, near_miss: 1 }, bySeverity: { high: 3, low: 1 } });
    expect(summary.repeatPatterns).toEqual([{ pattern: "injury at BLR-IND", count: 2 }]);
    expect((await IncidentService.summary(scopeOf(admin, storeB.id), {})).total).toBe(1);
    await refused(IncidentService.summary(null, { from: "bad" }), 400);
  });

  it("attaches photo links: a reporter to their own incident, a manager to the store's, nobody else", async () => {
    const id = await incidentIn(staffA);
    const body = { photos: [{ url: "https://img.example.com/1.jpg", caption: "Floor" }] };
    expect((await IncidentService.addPhotos(id, scopeOf(staffA), staffA, body)).photos).toHaveLength(1);
    await refused(IncidentService.addPhotos(id, scopeOf(staffA2), staffA2, body), 404);
    await refused(IncidentService.addPhotos(id, null, driver, body), 404);
    await refused(IncidentService.addPhotos(id, scopeOf(managerB), managerB, body), 404);
    await IncidentService.addPhotos(id, scopeOf(managerA), managerA, body);
    await IncidentService.addPhotos(id, null, hr, body);
    expect((await view(id)).photos).toHaveLength(3);
  });

  it("a rider reaches only their own incident's photos", async () => {
    const mine = await incidentIn(driver, { type: "vehicle_accident" });
    expect((await IncidentService.addPhotos(mine, null, driver, { photos: [{ url: "https://img.example.com/a.jpg" }] })).photos).toHaveLength(1);
  });

  it("validates and bounds photo links; concurrent uploads both land", async () => {
    const id = await incidentIn();
    await refused(IncidentService.addPhotos(id, null, admin, {}), 400, /photos/);
    await refused(IncidentService.addPhotos(id, null, admin, { photos: [] }), 400);
    await refused(IncidentService.addPhotos(id, null, admin, { photos: [{ url: "http://x.example.com/a" }] }), 400, /https/);
    await refused(IncidentService.addPhotos(id, null, admin, { photos: Array.from({ length: 11 }, (_, i) => ({ url: `https://x.example.com/${i}` })) }), 400, /at most 10/);
    await Promise.all([
      IncidentService.addPhotos(id, null, admin, { photos: [{ url: "https://x.example.com/1" }] }),
      IncidentService.addPhotos(id, null, hr, { photos: [{ url: "https://x.example.com/2" }] }),
    ]);
    expect(state.incidents.get(id).photos).toHaveLength(2);
    await IncidentService.addPhotos(id, null, admin, { photos: Array.from({ length: 10 }, (_, i) => ({ url: `https://x.example.com/b${i}` })) });
    await IncidentService.addPhotos(id, null, admin, { photos: Array.from({ length: 8 }, (_, i) => ({ url: `https://x.example.com/c${i}` })) });
    await refused(IncidentService.addPhotos(id, null, admin, { photos: [{ url: "https://x.example.com/over" }] }), 409, /at most 20/i);
  });

  it("raises one claim per incident through the insurance module and remembers its id", async () => {
    const id = await incidentIn(staffA, { type: "fire_risk" });
    const policyId = uuid();
    const claimId = uuid();
    claimCreate.mockResolvedValue({ id: claimId });
    expect(await IncidentService.raiseClaim(id, null, admin, { policyId, claimAmount: 1250.5 })).toEqual({ claimId });
    expect(claimCreate).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ policyId, incidentId: id, type: "fire", claimAmount: 1250.5, storeId: storeA.id }),
      `incident-claim-${id}`
    );
    expect(await IncidentService.raiseClaim(id, null, admin, { policyId, claimAmount: 1250.5 })).toEqual({ claimId });
    expect(claimCreate).toHaveBeenCalledTimes(1);
    expect(state.activity.filter((a) => a.action === "claim_raised")).toHaveLength(1);
  });

  it("leaves the incident untouched when the claim is refused or the module fails", async () => {
    const id = await incidentIn();
    await refused(IncidentService.raiseClaim(id, null, admin, { claimAmount: 5 }), 400, /policyId/);
    await refused(IncidentService.raiseClaim(id, null, admin, { policyId: uuid() }), 400, /claimAmount/);
    claimCreate.mockRejectedValueOnce(new CustomException("Insurance policy not found.", 404));
    await refused(IncidentService.raiseClaim(id, null, admin, { policyId: uuid(), claimAmount: 5 }), 404);
    claimCreate.mockRejectedValueOnce(new Error("db down"));
    await refused(IncidentService.raiseClaim(id, null, admin, { policyId: uuid(), claimAmount: 5 }), 500);
    expect(state.incidents.get(id).claimId).toBeNull();
    expect(state.activity.filter((a) => a.action === "claim_raised")).toHaveLength(0);
  });
});

describe("history is append-only and every change writes it", () => {
  it("each state change in the three modules adds exactly one row, none are edited", async () => {
    const item = await addItem(admin);
    await ComplianceService.renew(item.id, null, admin, { newExpiresOn: day(500) });
    await ComplianceService.setChecklist(item.id, null, admin, { items: [{ title: "t" }] });
    const audit = await startedAudit();
    const finding = await addFinding(audit.id);
    await AuditService.closeFinding(finding.id, null, admin, { correctiveAction: "ok" });
    await AuditService.complete(audit.id, null, admin, {});
    const id = await incidentIn();
    await assigned(id);
    expect(state.activity.map((a) => `${a.entity}:${a.action}`)).toEqual([
      "compliance_item:created", "compliance_item:renewed", "compliance_item:checklist_set",
      "audit:created", "audit:started", "audit_finding:created", "audit_finding:closed", "audit:completed",
      "incident:reported", "incident:assigned",
    ]);
    expect(new Set(state.activity.map((a) => a.id)).size).toBe(state.activity.length);
    expect(state.activity.every((a) => a.actorId)).toBe(true);
  });

  it("a failed change leaves no history row and no half-written state", async () => {
    const audit = await startedAudit();
    const before = state.activity.length;
    await refused(AuditService.complete(audit.id, null, admin, { waiveCriticalReason: "x".repeat(501) }), 400);
    await refused(addFinding(audit.id, { severity: "critical", ownerId: uuid() }), 400);
    expect(state.activity.length).toBe(before);
    expect(state.findings.size).toBe(0);
  });
});
