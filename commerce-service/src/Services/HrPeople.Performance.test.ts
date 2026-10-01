jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Hr.Transaction.js", () => ({ inHrTransaction: require("../Testing/InMemoryHrPeople.js").inHrTransaction }));
jest.mock("../Queries/Employee.Query.js", () => ({ EmployeeQuery: require("../Testing/InMemoryHrPeople.js").employeeQuery, UNASSIGNED_STORE: "unassigned" }));
jest.mock("../Queries/Training.Query.js", () => ({ TrainingQuery: require("../Testing/InMemoryHrPeople.js").trainingQuery }));
jest.mock("../Queries/Performance.Query.js", () => ({ PerformanceQuery: require("../Testing/InMemoryHrPeople.js").performanceQuery }));
jest.mock("../Queries/Attendance.Query.js", () => ({ AttendanceQuery: require("../Testing/InMemoryHrPeople.js").attendanceQuery }));
jest.mock("../Queries/Leave.Query.js", () => ({ LeaveQuery: require("../Testing/InMemoryHrPeople.js").leaveQuery }));
jest.mock("../Queries/Holiday.Query.js", () => ({ HolidayQuery: require("../Testing/InMemoryHrPeople.js").holidayQuery }));

import { reset, seed, state } from "../Testing/InMemoryHrPeople.js";
import { World, actor, buildWorld, ref, refused, scopeOf, setNow } from "../Testing/HrPeopleKit.js";
import { PerformanceService } from "./Performance.Service.js";

let w: World;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const schedule = async (employee: any, over: Record<string, unknown> = {}, scope: string | null = null) =>
  (await PerformanceService.createAppraisal(w.hr, scope, { employeeId: employee.id, cycle: "2026-H2", scheduledFor: "2026-10-15", ...over })) as any;
const conduct = (id: string, over: Record<string, unknown> = {}, user = w.hr) =>
  PerformanceService.conductAppraisal(user, id, null, { rating: 4, strengths: "Reliable", goals: ["Lead a shift"], ...over });

const attend = (employee: any, from: string, count: number, status: "present" | "late" = "present") => {
  for (let i = 0; i < count; i += 1) {
    state.attendance.push({ employeeId: employee.id, storeId: employee.storeId, date: new Date(d(from).getTime() + i * 86_400_000), status });
  }
};

beforeEach(() => {
  reset();
  setNow();
  w = buildWorld();
});
afterEach(() => jest.restoreAllMocks());

describe("scheduling appraisals", () => {
  it("creates one, defaulting the reviewer to the person's manager", async () => {
    const reviewer = seed.employee({ name: "Boss", employeeType: "manager", storeId: w.storeA });
    const subject = seed.employee({ name: "Dev", storeId: w.storeA, reportingTo: reviewer.id });
    const a = await schedule(subject);
    expect(a).toMatchObject({ employeeId: subject.id, employeeName: "Dev", cycle: "2026-H2", scheduledFor: "2026-10-15", status: "scheduled", reviewerId: reviewer.id, rating: null });
  });

  it("allows one appraisal per person and cycle (409), but another cycle is fine", async () => {
    await schedule(w.a1);
    await refused(schedule(w.a1), 409, /already has an appraisal for that cycle/);
    await schedule(w.a1, { cycle: "2027-H1" });
    expect(state.appraisals.size).toBe(2);
  });

  it("two simultaneous creations for one cycle leave one appraisal", async () => {
    const results = await Promise.allSettled([schedule(w.a1), schedule(w.a1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.appraisals.size).toBe(1);
  });

  it.each([
    ["no employee", { employeeId: undefined }, 400, /employeeId must be a valid id/],
    ["no cycle", { cycle: undefined }, 400, /cycle is required/],
    ["a cycle with odd characters", { cycle: "<b>" }, 400, /cycle may use/],
    ["a date far in the past", { scheduledFor: "2026-01-01" }, 400, /scheduledFor must be within/],
    ["a date over a year ahead", { scheduledFor: "2027-11-01" }, 400, /scheduledFor must be within/],
    ["a status other than scheduled", { status: "completed" }, 400, /starts as scheduled/],
    ["themself as reviewer", { reviewerId: "SELF" }, 400, /own reviewer/],
    ["an unknown reviewer", { reviewerId: "11111111-1111-4111-8111-111111111111" }, 400, /reviewerId must be an existing employee/],
    ["someone in another store", { employeeId: "B1" }, 404, /Employee not found/],
  ])("refuses %s", async (_label, over, status, message) => {
    const body: Record<string, unknown> = { ...over };
    if (body.reviewerId === "SELF") body.reviewerId = w.a1.id;
    if (body.employeeId === "B1") body.employeeId = w.b1.id;
    const employee = body.employeeId === w.b1.id ? w.b1 : w.a1;
    await refused(PerformanceService.createAppraisal(w.hr, w.storeA, { employeeId: employee.id, cycle: "2026-H2", scheduledFor: "2026-10-15", ...body }), status, message);
    expect(state.appraisals.size).toBe(0);
  });

  it("refuses someone who has left", async () => {
    const gone = seed.employee({ status: "exited" });
    await refused(schedule(gone), 400, /has left/);
  });

  it("schedules a group at once, deriving the cycle from the date and skipping people who already have it", async () => {
    await schedule(w.a1, { cycle: "2026-H2" });
    const result = await PerformanceService.scheduleAppraisals(w.hr, null, { employeeIds: [w.a1.id, w.a2.id], scheduledFor: "2026-10-20" });
    expect(result).toMatchObject({ cycle: "2026-H2", scheduled: 1, skipped: [w.a1.id] });
    expect(result.appraisals[0]).toMatchObject({ employeeId: w.a2.id, employeeName: "Bina" });
    const half1 = await PerformanceService.scheduleAppraisals(w.hr, null, { employeeIds: [w.a1.id], scheduledFor: "2027-02-01", cycle: "FY27" });
    expect(half1.cycle).toBe("FY27");
  });

  it("refuses a group with an unknown person or more than 100, creating nothing", async () => {
    await refused(PerformanceService.scheduleAppraisals(w.hr, null, { employeeIds: [w.a1.id, "11111111-1111-4111-8111-111111111111"], scheduledFor: "2026-10-20" }), 404);
    await refused(PerformanceService.scheduleAppraisals(w.hr, w.storeA, { employeeIds: [w.a1.id, w.b1.id], scheduledFor: "2026-10-20" }), 404);
    await refused(PerformanceService.scheduleAppraisals(w.hr, null, { employeeIds: [], scheduledFor: "2026-10-20" }), 400);
    expect(state.appraisals.size).toBe(0);
  });
});

describe("the review: conduct then complete", () => {
  it("runs scheduled, conducted (in_progress, rated), completed with an outcome", async () => {
    const a = await schedule(w.a1);
    const conducted = await conduct(a.id, { rating: 5 });
    expect(conducted).toMatchObject({ status: "in_progress", rating: 5, strengths: "Reliable", goals: ["Lead a shift"] });
    expect(conducted.conductedAt).toBe("2026-10-01T05:00:00.000Z");
    const done = await PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "increment", note: "10%" });
    expect(done).toMatchObject({ status: "completed", outcome: "increment", outcomeNote: "10%", rating: 5 });
  });

  it("a rating is written once: a second conduct is refused and the rating never changes", async () => {
    const a = await schedule(w.a1);
    await conduct(a.id, { rating: 3 });
    await refused(conduct(a.id, { rating: 5 }), 409, /rating cannot change/);
    expect((await PerformanceService.getAppraisal(a.id, null)).rating).toBe(3);
  });

  it("of two simultaneous conducts exactly one is recorded", async () => {
    const a = await schedule(w.a1);
    const results = await Promise.allSettled([conduct(a.id, { rating: 2 }), conduct(a.id, { rating: 5 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([2, 5]).toContain(state.appraisals.get(a.id).rating);
  });

  it("cannot be completed before it was conducted, nor twice, nor edited after", async () => {
    const a = await schedule(w.a1);
    await refused(PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "no_change" }), 409, /Conduct the appraisal/);
    await conduct(a.id);
    await PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "no_change" });
    await refused(PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "promoted" }), 409, /already completed/);
    await refused(conduct(a.id, { rating: 1 }), 409);
    await refused(PerformanceService.updateAppraisal(a.id, null, { cycle: "2028-H1" }), 409, /before the appraisal starts/);
    expect((await PerformanceService.getAppraisal(a.id, null)).outcome).toBe("no_change");
  });

  it.each([
    ["a rating of 0", { rating: 0 }, /rating must be a whole number from 1 to 5/],
    ["a rating of 6", { rating: 6 }, /rating/],
    ["a half rating", { rating: 3.5 }, /rating/],
    ["a text rating", { rating: "4" }, /rating/],
    ["no rating", { rating: undefined }, /rating/],
    ["too many goals", { goals: Array.from({ length: 11 }, () => "g") }, /at most 10/],
    ["an over-long strength note", { strengths: "x".repeat(2001) }, /at most 2000/],
  ])("refuses %s when conducting", async (_label, over, message) => {
    const a = await schedule(w.a1);
    await refused(PerformanceService.conductAppraisal(w.hr, a.id, null, { rating: 4, ...over }), 400, message);
    expect(state.appraisals.get(a.id).rating).toBeNull();
  });

  it("refuses an unknown outcome when completing", async () => {
    const a = await schedule(w.a1);
    await conduct(a.id);
    await refused(PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "fired" }), 400, /outcome must be one of/);
    await refused(PerformanceService.completeAppraisal(w.hr, a.id, null, {}), 400);
  });

  it("nobody conducts their own appraisal, whatever their role", async () => {
    const hrPerson = w.hrPerson;
    const a = await schedule(hrPerson);
    await refused(conduct(a.id, {}, w.hr), 403, /your own appraisal/);
    expect(state.appraisals.get(a.id).rating).toBeNull();
  });
});

describe("editing the schedule", () => {
  it("changes cycle, date and reviewer while scheduled and can start it", async () => {
    const reviewer = seed.employee({ name: "R", employeeType: "manager", storeId: w.storeA });
    const a = await schedule(w.a1);
    const edited = await PerformanceService.updateAppraisal(a.id, null, { scheduledFor: "2026-11-01", reviewerId: reviewer.id, cycle: "2026-Q4" });
    expect(edited).toMatchObject({ scheduledFor: "2026-11-01", reviewerId: reviewer.id, cycle: "2026-Q4", status: "scheduled" });
    expect(await PerformanceService.updateAppraisal(a.id, null, { status: "in_progress" })).toMatchObject({ status: "in_progress" });
    await refused(PerformanceService.updateAppraisal(a.id, null, { status: "scheduled" }), 409, /cannot go back/);
    await refused(PerformanceService.updateAppraisal(a.id, null, { scheduledFor: "2026-11-02" }), 409, /before the appraisal starts/);
  });

  it("refuses to complete through an edit, to move to another person, to clash with another cycle, and an empty edit", async () => {
    const a = await schedule(w.a1);
    await schedule(w.a1, { cycle: "2027-H1" });
    await refused(PerformanceService.updateAppraisal(a.id, null, { status: "completed" }), 400, /complete action/);
    await refused(PerformanceService.updateAppraisal(a.id, null, { employeeId: w.a2.id }), 400, /cannot be changed/);
    await refused(PerformanceService.updateAppraisal(a.id, null, { cycle: "2027-H1" }), 409, /already has an appraisal/);
    await refused(PerformanceService.updateAppraisal(a.id, null, {}), 400, /Nothing to update/);
    expect(state.appraisals.get(a.id).cycle).toBe("2026-H2");
  });
});

describe("listing and isolation between stores", () => {
  it("filters, pages and names people", async () => {
    await schedule(w.a1);
    await schedule(w.a2, { cycle: "2027-H1" });
    const b = await schedule(w.b1);
    await conduct(b.id);
    expect((await PerformanceService.listAppraisals(null, {})).total).toBe(3);
    expect((await PerformanceService.listAppraisals(null, { cycle: "2027-H1" })).items.map((x) => x.employeeName)).toEqual(["Bina"]);
    expect((await PerformanceService.listAppraisals(null, { status: "in_progress" })).items.map((x) => x.employeeName)).toEqual(["Chitra"]);
    expect((await PerformanceService.listAppraisals(null, { employeeId: w.a1.id })).total).toBe(1);
    expect((await PerformanceService.listAppraisals(null, { limit: "500" })).limit).toBe(100);
    await refused(PerformanceService.listAppraisals(null, { status: "x" }), 400);
  });

  it("a store-scoped caller never sees, reads or changes another store's appraisal (404)", async () => {
    const a = await schedule(w.a1);
    const b = await schedule(w.b1);
    const scope = scopeOf(w.managerA);
    expect((await PerformanceService.listAppraisals(scope, {})).items.map((x) => x.id)).toEqual([a.id]);
    await refused(PerformanceService.listAppraisals(scope, { employeeId: w.b1.id }), 404);
    await refused(PerformanceService.getAppraisal(b.id, scope), 404);
    await refused(PerformanceService.updateAppraisal(b.id, scope, { scheduledFor: "2026-11-01" }), 404);
    await refused(PerformanceService.conductAppraisal(w.hr, b.id, scope, { rating: 3 }), 404);
    await refused(PerformanceService.completeAppraisal(w.hr, b.id, scope, { outcome: "no_change" }), 404);
    await refused(PerformanceService.getAppraisal("nope", null), 404);
    await refused(PerformanceService.getAppraisal("11111111-1111-4111-8111-111111111111", null), 404);
  });

  it("shows an employee their own appraisals, with rating and outcome only once completed", async () => {
    const a = await schedule(w.a1);
    expect((await PerformanceService.listMine(ref(w.a1))).items[0]).toMatchObject({ status: "scheduled", rating: null, outcome: null });
    await conduct(a.id, { rating: 5 });
    expect((await PerformanceService.listMine(ref(w.a1))).items[0]).toMatchObject({ status: "in_progress", rating: null });
    await PerformanceService.completeAppraisal(w.hr, a.id, null, { outcome: "promoted" });
    expect((await PerformanceService.listMine(ref(w.a1))).items[0]).toMatchObject({ status: "completed", rating: 5, outcome: "promoted" });
    expect((await PerformanceService.listMine(ref(w.a2))).items).toEqual([]);
  });
});

describe("the performance record", () => {
  it("scores attendance, punctuality, training and rating over a period, with trends", async () => {
    attend(w.a1, "2026-09-02", 8); // earlier 30 days: Sep 2 - Sep 9 present
    attend(w.a1, "2026-09-14", 10); // this period: 10 present
    attend(w.a1, "2026-09-24", 2, "late"); // 2 late
    const result = await PerformanceService.getEmployeePerformance(w.a1.id, null, { from: "2026-09-13", to: "2026-10-01" });
    expect(result).toMatchObject({ employeeId: w.a1.id, name: "Asha", from: "2026-09-13", to: "2026-10-01" });
    const attendance = result.metrics.find((m) => m.name === "Attendance rate (%)");
    expect(attendance).toMatchObject({ target: 95, actual: 63.2 }); // 12 of 19 days
    expect(result.metrics.find((m) => m.name === "Punctuality (%)")).toMatchObject({ actual: 83.3 });
    expect(attendance?.trend).toBe("up"); // the 19 days before had 8 attended
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it("counts approved leave and holidays out of the days expected", async () => {
    attend(w.a1, "2026-09-01", 5);
    state.leave.push({ employeeId: w.a1.id, fromDate: d("2026-09-06"), toDate: d("2026-09-10"), halfDay: false });
    state.holidays.push({ date: d("2026-09-11"), type: "public", storeIds: [] });
    const r = await PerformanceService.getEmployeePerformance(w.a1.id, null, { from: "2026-09-01", to: "2026-09-12" });
    // 12 days - 5 leave - 1 holiday = 6 expected, 5 attended
    expect(r.metrics.find((m) => m.name === "Attendance rate (%)")?.actual).toBe(83.3);
  });

  it("has no score for a period before the person joined (nothing to measure), and uses the latest rating in the period", async () => {
    expect(await PerformanceService.getEmployeePerformance(w.a2.id, null, { from: "2025-12-01", to: "2025-12-02" })).toMatchObject({ score: null, metrics: [] });
    const a = await schedule(w.a1);
    await conduct(a.id, { rating: 3 });
    const r = await PerformanceService.getEmployeePerformance(w.a1.id, null, {});
    expect(r.metrics.find((m) => m.name === "Appraisal rating (1-5)")).toMatchObject({ target: 4, actual: 3 });
  });

  it("validates the range and keeps stores apart", async () => {
    await refused(PerformanceService.getEmployeePerformance(w.a1.id, null, { from: "2026-01-01", to: "2026-10-01" }), 400, /at most 92 days/);
    await refused(PerformanceService.getEmployeePerformance(w.a1.id, null, { from: "2026-10-01", to: "2026-09-01" }), 400, /from must not be after to/);
    await refused(PerformanceService.getEmployeePerformance(w.b1.id, scopeOf(w.managerA), {}), 404);
    await refused(PerformanceService.getEmployeePerformance("nope", null, {}), 404);
    expect(await PerformanceService.getMine(ref(w.a1), { from: "2025-12-01", to: "2025-12-02" })).toEqual({ score: null, metrics: [] });
  });

  it("ranks a store or the company for a month, with a rating distribution, paged", async () => {
    attend(w.a1, "2026-09-01", 28);
    attend(w.a2, "2026-09-01", 14);
    attend(w.b1, "2026-09-01", 28);
    const a = await schedule(w.a1, { cycle: "S1" });
    const b = await schedule(w.b1, { cycle: "S1" });
    state.appraisals.get(a.id).rating = 4;
    state.appraisals.get(a.id).conductedAt = new Date("2026-09-10T05:00:00Z");
    state.appraisals.get(b.id).rating = 2;
    state.appraisals.get(b.id).conductedAt = new Date("2026-09-12T05:00:00Z");
    const all = await PerformanceService.getSummary(null, { period: "2026-09" });
    expect(all.period).toBe("2026-09");
    expect(all.employees.slice(0, 3).map((e) => e.name)).toEqual(["Asha", "Chitra", "Bina"]);
    expect(all.employees.find((e) => e.name === "Asha")?.rank).toBe(1);
    expect(all.employees.find((e) => e.name === "Bina")?.rank).toBeGreaterThan(1);
    expect(all.ratingDistribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
    expect(all.total).toBe(5);
    const paged = await PerformanceService.getSummary(null, { period: "2026-09", limit: "2", page: "2" });
    expect(paged.employees).toHaveLength(2);
    expect(paged).toMatchObject({ page: 2, limit: 2, total: 5 });
  });

  it("a manager's summary covers their store only; another store is a 404", async () => {
    attend(w.a1, "2026-09-01", 28);
    attend(w.b1, "2026-09-01", 28);
    const scope = scopeOf(w.managerA);
    const mine = await PerformanceService.getSummary(scope, { period: "2026-09" });
    expect(mine.employees.map((e) => e.name).sort()).toEqual(["Asha", "Bina", "Meera Nair"]);
    await refused(PerformanceService.getSummary(scope, { storeId: w.storeB }), 404);
    await refused(PerformanceService.getSummary(null, { period: "2026-13" }), 400);
    expect((await PerformanceService.getSummary(null, { storeId: w.storeB, period: "2026-09" })).employees.map((e) => e.name)).toEqual(["Chitra"]);
  });
});

void actor;
