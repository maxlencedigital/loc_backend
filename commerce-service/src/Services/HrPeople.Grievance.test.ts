jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Hr.Transaction.js", () => ({ inHrTransaction: require("../Testing/InMemoryHrPeople.js").inHrTransaction }));
jest.mock("../Queries/Employee.Query.js", () => ({ EmployeeQuery: require("../Testing/InMemoryHrPeople.js").employeeQuery, UNASSIGNED_STORE: "unassigned" }));
jest.mock("../Queries/Grievance.Query.js", () => ({ GrievanceQuery: require("../Testing/InMemoryHrPeople.js").grievanceQuery }));
jest.mock("../Queries/Training.Query.js", () => ({ TrainingQuery: require("../Testing/InMemoryHrPeople.js").trainingQuery }));

import { reset, seed, state } from "../Testing/InMemoryHrPeople.js";
import { World, buildWorld, ref, refused, scopeOf, setNow } from "../Testing/HrPeopleKit.js";
import { GrievanceService } from "./Grievance.Service.js";
import { HrRequestService } from "./HrRequest.Service.js";
import { countOpenGrievances } from "./PeopleSummary.js";

let w: World;
let hrOfficer: any;
const hr = () => scopeOf(w.hr);

const raise = async (employee: any, over: Record<string, unknown> = {}) =>
  (await GrievanceService.raise(ref(employee), { category: "pay", description: "My overtime was not paid.", ...over })) as any;

beforeEach(() => {
  reset();
  setNow();
  w = buildWorld();
  hrOfficer = w.hrPerson;
});
afterEach(() => jest.restoreAllMocks());

describe("raising a concern", () => {
  it("records it open, with a first-response deadline of 48 hours and 14 days to resolve", async () => {
    const g = await raise(w.a1);
    expect(g).toMatchObject({ category: "pay", status: "open", anonymous: false, closedAt: null, notes: [] });
    const row = [...state.grievances.values()][0];
    expect(row.firstResponseDueAt.toISOString()).toBe("2026-10-03T05:00:00.000Z");
    expect(row.resolutionDueAt.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(row).toMatchObject({ employeeId: w.a1.id, confidential: true });
  });

  it("gives harassment and discrimination 7 days and makes them confidential whatever was asked", async () => {
    await raise(w.a1, { category: "harassment", confidential: false });
    await raise(w.a1, { category: "workload", confidential: false });
    const [serious, normal] = [...state.grievances.values()];
    expect(serious).toMatchObject({ confidential: true });
    expect(serious.resolutionDueAt.toISOString()).toBe("2026-10-08T05:00:00.000Z");
    expect(normal.confidential).toBe(false);
  });

  it.each([
    ["no category", { category: undefined }, /category must be one of/],
    ["an unknown category", { category: "gossip" }, /category must be one of/],
    ["no description", { description: undefined }, /description is required/],
    ["a huge description", { description: "x".repeat(4001) }, /at most 4000/],
    ["a text anonymous flag", { anonymous: "yes" }, /anonymous must be true or false/],
    ["a case against themself", { againstEmployeeId: "SELF" }, /cannot be yourself/],
    ["a case against nobody real", { againstEmployeeId: "11111111-1111-4111-8111-111111111111" }, /existing employee/],
  ])("refuses %s", async (_label, over, message) => {
    const body: Record<string, unknown> = { ...over };
    if (body.againstEmployeeId === "SELF") body.againstEmployeeId = w.a1.id;
    await refused(raise(w.a1, body), 400, message);
    expect(state.grievances.size).toBe(0);
  });

  it("does not let the client choose the owner, status or deadlines", async () => {
    await raise(w.a1, { employeeId: w.a2.id, status: "closed", resolutionDueAt: "2030-01-01" });
    const row = [...state.grievances.values()][0];
    expect(row.employeeId).toBe(w.a1.id);
    expect(row.status).toBe("open");
    expect(row.resolutionDueAt.getUTCFullYear()).toBe(2026);
  });

  it("lets the person follow only their own cases, with HR's internal notes hidden", async () => {
    const mine = await raise(w.a1);
    await raise(w.a2);
    await GrievanceService.comment(w.hr, null, mine.id, { message: "Looking into payroll.", internal: false });
    await GrievanceService.comment(w.hr, null, mine.id, { message: "Payroll may have a pattern here.", internal: true });
    const list = await GrievanceService.listMine(ref(w.a1), {});
    expect(list.items.map((i) => i.id)).toEqual([mine.id]);
    const own = await GrievanceService.getMine(ref(w.a1), mine.id);
    expect(own.notes.map((n) => n.message)).toEqual(["Looking into payroll."]);
    expect(own).not.toHaveProperty("assigneeId");
    expect(own).not.toHaveProperty("againstEmployeeId");
    await refused(GrievanceService.getMine(ref(w.a2), mine.id), 404);
    await refused(GrievanceService.getMine(ref(w.a1), "nope"), 404);
    expect((await GrievanceService.listMine(ref(w.a1), { status: "closed" })).total).toBe(0);
  });
});

describe("what HR sees", () => {
  it("lists with filters and pages, newest first", async () => {
    const a = await raise(w.a1);
    setNow("2026-10-01T06:00:00.000Z");
    const b = await raise(w.a2, { category: "safety" });
    expect((await GrievanceService.list(w.hr, null, {})).items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect((await GrievanceService.list(w.hr, null, { category: "safety" })).total).toBe(1);
    expect((await GrievanceService.list(w.hr, null, { status: "closed" })).total).toBe(0);
    expect((await GrievanceService.list(w.hr, null, { from: "2026-10-02" })).total).toBe(0);
    expect((await GrievanceService.list(w.hr, null, { from: "2026-10-01", to: "2026-10-01" })).total).toBe(2);
    expect((await GrievanceService.list(w.hr, null, { limit: "1" })).items).toHaveLength(1);
    expect((await GrievanceService.list(w.hr, null, { limit: "999" })).limit).toBe(100);
    await refused(GrievanceService.list(w.hr, null, { status: "x" }), 400);
    await refused(GrievanceService.list(w.hr, null, { assigneeId: "x" }), 400);
    await refused(GrievanceService.list(w.hr, null, { from: "2026-10-05", to: "2026-10-01" }), 400);
  });

  it("names who raised a case, but not when it was raised anonymously", async () => {
    await raise(w.a1);
    await raise(w.a2, { anonymous: true });
    const items = (await GrievanceService.list(w.hr, null, {})).items;
    const named = items.find((i: any) => i.employeeName === "Asha");
    const hidden = items.find((i: any) => i.anonymous);
    expect(named).toMatchObject({ employeeId: w.a1.id });
    expect(hidden).not.toHaveProperty("employeeId");
    expect(hidden).not.toHaveProperty("employeeName");
    const detail = await GrievanceService.get(w.hr, null, (hidden as any).id);
    expect(JSON.stringify(detail)).not.toContain(w.a2.id);
    expect(JSON.stringify(detail)).not.toContain("Bina");
    // the person can still follow it
    expect((await GrievanceService.listMine(ref(w.a2), {})).total).toBe(1);
  });

  it("shows a case with its full history, including internal notes", async () => {
    const g = await raise(w.a1);
    await GrievanceService.comment(w.hr, null, g.id, { message: "Public reply" });
    await GrievanceService.comment(w.hr, null, g.id, { message: "Private thought", internal: true });
    const detail = await GrievanceService.get(w.hr, null, g.id);
    expect(detail).toMatchObject({ id: g.id, description: "My overtime was not paid.", employeeName: "Asha", slaBreached: false });
    expect(detail.notes.map((n: any) => [n.message, n.internal])).toEqual([["Public reply", false], ["Private thought", true]]);
  });

  it("flags a case that has passed its deadline", async () => {
    const g = await raise(w.a1);
    setNow("2026-10-05T05:00:00.000Z");
    expect((await GrievanceService.get(w.hr, null, g.id)).slaBreached).toBe(true);
  });

  it("an admin viewing one store sees only that store's cases, other stores' are 404", async () => {
    const a = await raise(w.a1);
    const b = await raise(w.b1);
    expect((await GrievanceService.list(w.admin, w.storeA, {})).items.map((i) => i.id)).toEqual([a.id]);
    await refused(GrievanceService.get(w.admin, w.storeA, b.id), 404);
    await refused(GrievanceService.get(w.hr, null, "nope"), 404);
  });
});

describe("a store manager's narrower view", () => {
  it("sees non-confidential cases of their own store only, and never one filed against them", async () => {
    const open = await raise(w.a1, { confidential: false });
    await raise(w.a2, { confidential: true });
    const againstMe = await raise(w.a1, { confidential: false, againstEmployeeId: w.managerPersonA.id });
    const otherStore = await raise(w.b1, { confidential: false });
    const scope = scopeOf(w.managerA);
    expect((await GrievanceService.list(w.managerA, scope, {})).items.map((i) => i.id)).toEqual([open.id]);
    expect((await GrievanceService.get(w.managerA, scope, open.id)).id).toBe(open.id);
    await refused(GrievanceService.get(w.managerA, scope, againstMe.id), 404);
    await refused(GrievanceService.get(w.managerA, scope, otherStore.id), 404);
    const confidential = [...state.grievances.values()].find((g) => g.confidential)!;
    await refused(GrievanceService.get(w.managerA, scope, confidential.id), 404);
    await refused(GrievanceService.comment(w.managerA, scope, againstMe.id, { message: "x" }), 404);
  });

  it("a driver or staff member has no HR view at all", async () => {
    await refused(GrievanceService.list({ ...w.hr, role: "staff" }, null, {}), 403);
  });

  it("counts open cases for the summary: all of them company-wide, only non-confidential ones for a store view", async () => {
    await raise(w.a1, { confidential: false });
    await raise(w.a1, { confidential: true });
    const closed = await raise(w.a2, { confidential: false });
    await GrievanceService.close(w.hr, null, closed.id, { outcome: "Resolved." });
    await raise(w.b1, { confidential: false });
    expect(await countOpenGrievances(null)).toBe(3);
    expect(await countOpenGrievances(w.storeA)).toBe(1);
  });
});

describe("working a case", () => {
  it("assigns, replies, escalates and closes with a recorded history and the deadlines tracked", async () => {
    const g = await raise(w.a1);
    const assigned = await GrievanceService.assign(w.hr, null, g.id, { assigneeId: hrOfficer.id });
    expect(assigned).toMatchObject({ status: "assigned", assigneeId: hrOfficer.id });
    expect(assigned.firstResponseAt).toBeTruthy();
    const replied = await GrievanceService.comment(w.hr, null, g.id, { message: "We are reviewing." });
    expect(replied.status).toBe("in_progress");
    const escalated = await GrievanceService.escalate(w.hr, null, g.id, { reason: "Needs the director." });
    expect(escalated).toMatchObject({ status: "escalated", escalationReason: "Needs the director." });
    const closed = await GrievanceService.close(w.hr, null, g.id, { outcome: "Overtime repaid." });
    expect(closed).toMatchObject({ status: "closed", outcome: "Overtime repaid.", closedAt: "2026-10-01T05:00:00.000Z" });
    expect(closed.notes.map((n: any) => n.kind)).toEqual(["assignment", "comment", "escalation", "closure"]);
    expect((await GrievanceService.getMine(ref(w.a1), g.id)).outcome).toBe("Overtime repaid.");
  });

  it("an internal comment does not count as a reply nor move the case on", async () => {
    const g = await raise(w.a1);
    await GrievanceService.assign(w.hr, null, g.id, { assigneeId: hrOfficer.id });
    state.grievances.get(g.id).firstResponseAt = null;
    const after = await GrievanceService.comment(w.hr, null, g.id, { message: "note to self", internal: true });
    expect(after.status).toBe("assigned");
    expect(after.firstResponseAt).toBeNull();
  });

  it("a closed case accepts nothing further", async () => {
    const g = await raise(w.a1);
    await GrievanceService.close(w.hr, null, g.id, { outcome: "Done." });
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: hrOfficer.id }), 409, /closed/);
    await refused(GrievanceService.comment(w.hr, null, g.id, { message: "late" }), 409, /closed/);
    await refused(GrievanceService.escalate(w.hr, null, g.id, { reason: "late" }), 409, /closed/);
    await refused(GrievanceService.close(w.hr, null, g.id, { outcome: "again" }), 409, /already closed/);
    expect(state.notes).toHaveLength(1);
  });

  it("escalates once; a case that is escalated can still be reassigned and closed", async () => {
    const g = await raise(w.a1);
    await GrievanceService.escalate(w.hr, null, g.id, { reason: "Urgent" });
    await refused(GrievanceService.escalate(w.hr, null, g.id, { reason: "Again" }), 409, /already escalated/);
    expect((await GrievanceService.assign(w.hr, null, g.id, { assigneeId: hrOfficer.id })).status).toBe("escalated");
    expect((await GrievanceService.close(w.hr, null, g.id, { outcome: "Settled" })).status).toBe("closed");
  });

  it("only an active HR or admin employee can be assigned, never the person involved", async () => {
    const g = await raise(w.a1, { againstEmployeeId: w.a2.id });
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: w.a2.id }), 400, /HR or admin employee/);
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: "11111111-1111-4111-8111-111111111111" }), 400, /HR employee/);
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: "x" }), 400, /assigneeId must be a valid id/);
    const gone = seed.employee({ employeeType: "hr", status: "exited" });
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: gone.id }), 400);
    const hrRaiser = await raise(hrOfficer);
    await refused(GrievanceService.assign(w.hr, null, hrRaiser.id, { assigneeId: hrOfficer.id }), 409, /person who raised it/);
    expect(state.notes).toHaveLength(0);
  });

  it.each([
    ["a comment with no message", (id: string) => GrievanceService.comment(w.hr, null, id, {}), /message is required/],
    ["a comment with a huge message", (id: string) => GrievanceService.comment(w.hr, null, id, { message: "x".repeat(4001) }), /at most 4000/],
    ["a comment with a text internal flag", (id: string) => GrievanceService.comment(w.hr, null, id, { message: "x", internal: "no" }), /internal must be true or false/],
    ["an escalation with no reason", (id: string) => GrievanceService.escalate(w.hr, null, id, {}), /reason is required/],
    ["a close with no outcome", (id: string) => GrievanceService.close(w.hr, null, id, {}), /outcome is required/],
    ["an assign with no assignee", (id: string) => GrievanceService.assign(w.hr, null, id, {}), /assigneeId must be a valid id/],
  ])("refuses %s", async (_label, act, message) => {
    const g = await raise(w.a1);
    await refused(act(g.id), 400, message);
    expect(state.notes).toHaveLength(0);
    expect(state.grievances.get(g.id).status).toBe("open");
  });

  it("history is append-only: every action adds a note and none is changed or removed", async () => {
    const g = await raise(w.a1);
    await GrievanceService.comment(w.hr, null, g.id, { message: "one" });
    const first = structuredClone(state.notes[0]);
    await GrievanceService.comment(w.hr, null, g.id, { message: "two" });
    await GrievanceService.escalate(w.hr, null, g.id, { reason: "r" });
    expect(state.notes).toHaveLength(3);
    expect(state.notes[0]).toEqual(first);
  });

  it("a failed history write rolls the whole transition back", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const g = await raise(w.a1);
    state.failNextNote = true;
    await refused(GrievanceService.close(w.hr, null, g.id, { outcome: "Settled" }), 500);
    expect(state.grievances.get(g.id)).toMatchObject({ status: "open", closedAt: null, outcome: null });
    state.failNextNote = true;
    await refused(GrievanceService.assign(w.hr, null, g.id, { assigneeId: hrOfficer.id }), 500);
    expect(state.grievances.get(g.id)).toMatchObject({ status: "open", assigneeId: null, firstResponseAt: null });
  });

  it("of two simultaneous closes exactly one succeeds, and of two escalations too", async () => {
    const g = await raise(w.a1);
    const closes = await Promise.allSettled([GrievanceService.close(w.hr, null, g.id, { outcome: "A" }), GrievanceService.close(w.hr, null, g.id, { outcome: "B" })]);
    expect(closes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.notes.filter((n) => n.kind === "closure")).toHaveLength(1);
    const h = await raise(w.a2);
    const escalations = await Promise.allSettled([GrievanceService.escalate(w.hr, null, h.id, { reason: "A" }), GrievanceService.escalate(w.hr, null, h.id, { reason: "B" })]);
    expect(escalations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("cannot act on another store's case from a store-scoped view (404)", async () => {
    const b = await raise(w.b1);
    for (const act of [
      () => GrievanceService.assign(w.admin, w.storeA, b.id, { assigneeId: hrOfficer.id }),
      () => GrievanceService.comment(w.admin, w.storeA, b.id, { message: "x" }),
      () => GrievanceService.escalate(w.admin, w.storeA, b.id, { reason: "x" }),
      () => GrievanceService.close(w.admin, w.storeA, b.id, { outcome: "x" }),
    ]) await refused(act(), 404);
    expect(state.notes).toHaveLength(0);
  });
});

describe("HR requests", () => {
  const send = async (employee: any, over: Record<string, unknown> = {}) =>
    (await HrRequestService.send(ref(employee), { category: "payroll", message: "When is payday?", ...over })) as any;

  it("an employee sends, HR answers and closes, and the employee reads the reply", async () => {
    const r = await send(w.a1);
    expect(r).toMatchObject({ status: "open", category: "payroll", employeeId: w.a1.id });
    expect(await HrRequestService.respond(w.hr, null, r.id, { message: "On the 7th." })).toMatchObject({ status: "answered", response: "On the 7th.", respondedBy: "Hema HR" });
    expect((await HrRequestService.getMine(ref(w.a1), r.id)).response).toBe("On the 7th.");
    expect(await HrRequestService.close(null, r.id, { note: "Thanks" })).toMatchObject({ status: "closed", closeNote: "Thanks" });
    await refused(HrRequestService.respond(w.hr, null, r.id, { message: "late" }), 409, /already been answered or closed/);
    await refused(HrRequestService.close(null, r.id, {}), 409, /already closed/);
  });

  it("an open request can be closed without an answer, and a request is answered once", async () => {
    const a = await send(w.a1);
    expect((await HrRequestService.close(null, a.id, {})).status).toBe("closed");
    const b = await send(w.a1);
    await HrRequestService.respond(w.hr, null, b.id, { message: "one" });
    await refused(HrRequestService.respond(w.hr, null, b.id, { message: "two" }), 409);
    const c = await send(w.a1);
    const racing = await Promise.allSettled([HrRequestService.respond(w.hr, null, c.id, { message: "x" }), HrRequestService.respond(w.hr, null, c.id, { message: "y" })]);
    expect(racing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it.each([
    ["no category", { category: undefined }, /category must be one of/],
    ["an unknown category", { category: "gossip" }, /category must be one of/],
    ["no message", { message: undefined }, /message is required/],
    ["a huge message", { message: "x".repeat(4001) }, /at most 4000/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(send(w.a1, over), 400, message);
    expect(state.requests.size).toBe(0);
  });

  it("lists with filters and pages, and keeps stores and people apart", async () => {
    const mine = await send(w.a1);
    await send(w.b1, { category: "benefits" });
    expect((await HrRequestService.list(null, {})).total).toBe(2);
    expect((await HrRequestService.list(null, { category: "benefits" })).items.map((i) => i.employeeName)).toEqual(["Chitra"]);
    expect((await HrRequestService.list(w.storeA, {})).items.map((i) => i.id)).toEqual([mine.id]);
    expect((await HrRequestService.list(null, { status: "answered" })).total).toBe(0);
    expect((await HrRequestService.list(null, { limit: "9999" })).limit).toBe(100);
    await refused(HrRequestService.list(null, { status: "x" }), 400);
    const theirs = [...state.requests.values()].find((r) => r.employeeId === w.b1.id)!;
    await refused(HrRequestService.get(w.storeA, theirs.id), 404);
    await refused(HrRequestService.respond(w.hr, w.storeA, theirs.id, { message: "x" }), 404);
    await refused(HrRequestService.close(w.storeA, theirs.id, {}), 404);
    await refused(HrRequestService.get(null, "nope"), 404);
    await refused(HrRequestService.getMine(ref(w.a2), mine.id), 404);
    expect((await HrRequestService.listMine(ref(w.a1), {})).items.map((i) => i.id)).toEqual([mine.id]);
    await refused(HrRequestService.respond(w.hr, null, mine.id, {}), 400, /message is required/);
  });
});

void hr;
