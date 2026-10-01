import { ServiceClient } from "../../commons/Http/ServiceClient.js";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Hr.Transaction.js", () => ({ inHrTransaction: require("../Testing/InMemoryHr.js").inHrTransaction }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryHr.js").storeQuery }));
jest.mock("../Queries/Employee.Query.js", () => ({
  EmployeeQuery: require("../Testing/InMemoryHr.js").employeeQuery,
  UNASSIGNED_STORE: "unassigned",
}));
jest.mock("../Queries/EmployeeDocument.Query.js", () => ({ EmployeeDocumentQuery: require("../Testing/InMemoryHr.js").documentQuery }));
jest.mock("../Queries/Onboarding.Query.js", () => ({ OnboardingQuery: require("../Testing/InMemoryHr.js").onboardingQuery }));
jest.mock("../Queries/Attendance.Query.js", () => ({ AttendanceQuery: require("../Testing/InMemoryHr.js").attendanceQuery }));
jest.mock("../Queries/Roster.Query.js", () => ({ RosterQuery: require("../Testing/InMemoryHr.js").rosterQuery }));
jest.mock("../Queries/Holiday.Query.js", () => ({ HolidayQuery: require("../Testing/InMemoryHr.js").holidayQuery }));
jest.mock("../Queries/Leave.Query.js", () => ({ LeaveQuery: require("../Testing/InMemoryHr.js").leaveQuery }));
jest.mock("../Queries/Career.Query.js", () => ({ CareerQuery: require("../Testing/InMemoryHr.js").careerQuery }));
jest.mock("../Queries/DailyReport.Query.js", () => ({ DailyReportQuery: require("../Testing/InMemoryHr.js").dailyReportQuery }));

import { reset, state } from "../Testing/InMemoryHr.js";
import { FIXED_NOW, TODAY, World, actor, buildWorld, hire, refused, resetCounter, scopeOf, setNow } from "../Testing/HrTestKit.js";
import { AttendanceService, LATE_GRACE_MINUTES } from "./Attendance.Service.js";
import { CareerService } from "./Career.Service.js";
import { CoverReportService } from "./CoverReport.Service.js";
import { EmployeeAccess } from "./EmployeeAccess.js";
import { EmployeeService } from "./Employee.Service.js";
import { HolidayService } from "./Holiday.Service.js";
import { LeaveService } from "./Leave.Service.js";
import { RosterService } from "./Roster.Service.js";
import { resetFieldCipher } from "../Utils/FieldCipher.js";

let w: World;
let inA: any;
let inA2: any;
let inB: any;

const ref = (id: string) => EmployeeAccess.assertEmployeeInScope(id, null);
const asHr = () => scopeOf(w.hr);
const asManagerA = () => scopeOf(w.managerA);

const requestLeave = async (employeeId: string, over: Record<string, unknown> = {}) =>
  LeaveService.createRequest(await ref(employeeId), { type: "casual", from: "2026-10-05", to: "2026-10-07", ...over });

const approve = (id: string, user = w.hr, scope = scopeOf(w.hr)) => LeaveService.approve(id, scope, user, {});

const leaveRows = (type = "casual") => [...state.balances.values()].filter((b) => b.type === type);

beforeAll(() => {
  process.env.IS_LOCAL = "true";
  resetFieldCipher();
});

beforeEach(() => {
  reset();
  resetCounter();
  setNow(FIXED_NOW.toISOString());
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(ServiceClient, "get").mockResolvedValue({ id: "x", role: "staff", isActive: true });
});

beforeEach(async () => {
  w = buildWorld();
  inA = await hire(w.hr, { storeId: w.storeA.id, name: "Asha" });
  inA2 = await hire(w.hr, { storeId: w.storeA.id, name: "Bina" });
  inB = await hire(w.hr, { storeId: w.storeB.id, name: "Chetan" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ================================================================ clock-in/out
describe("clocking in and out", () => {
  it("records a present day with the IST date and the clock-in instant", async () => {
    const day = await AttendanceService.clockIn(await ref(inA.id), {});
    expect(day).toEqual({ date: TODAY, status: "present", clockIn: FIXED_NOW.toISOString(), clockOut: null });
  });

  it("marks a clock-in later than the rostered start plus the grace as late, and within the grace as present", async () => {
    await RosterService.create(asHr(), w.hr, { employeeId: inA.id, storeId: w.storeA.id, date: TODAY, shiftStart: "09:00", shiftEnd: "17:00" });
    await RosterService.create(asHr(), w.hr, { employeeId: inA2.id, storeId: w.storeA.id, date: TODAY, shiftStart: "10:25", shiftEnd: "17:00" });
    expect((await AttendanceService.clockIn(await ref(inA.id), {})).status).toBe("late");
    expect(LATE_GRACE_MINUTES).toBe(10);
    expect((await AttendanceService.clockIn(await ref(inA2.id), {})).status).toBe("present");
  });

  it("refuses a second clock-in on the same day", async () => {
    await AttendanceService.clockIn(await ref(inA.id), {});
    await refused(AttendanceService.clockIn(await ref(inA.id), {}), 409, /Already clocked in/);
  });

  it("lets only one of two simultaneous clock-ins through", async () => {
    const me = await ref(inA.id);
    const results = await Promise.allSettled([AttendanceService.clockIn(me, {}), AttendanceService.clockIn(me, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason.errorCode).toBe(409);
    expect(state.attendance.size).toBe(1);
  });

  it("falls back to the unique day key when the checks were raced past", async () => {
    const me = await ref(inA.id);
    await AttendanceService.clockIn(me, {});
    // A record exists but the open-shift check is blind to it: the unique key still refuses.
    const row = [...state.attendance.values()][0];
    row.clockOut = new Date(FIXED_NOW.getTime() + 1000);
    await refused(AttendanceService.clockIn(me, {}), 409, /Already clocked in/);
  });

  it("clocks out the open day and refuses a clock-out when not clocked in", async () => {
    await refused(AttendanceService.clockOut(await ref(inA.id)), 409, /Not clocked in/);
    await AttendanceService.clockIn(await ref(inA.id), {});
    setNow("2026-10-01T12:00:00.000Z");
    const day = await AttendanceService.clockOut(await ref(inA.id));
    expect(day.clockOut).toBe("2026-10-01T12:00:00.000Z");
    await refused(AttendanceService.clockOut(await ref(inA.id)), 409, /Not clocked in/);
  });

  it("lets a shift run past midnight and be closed the next morning", async () => {
    setNow("2026-10-01T17:30:00.000Z"); // 23:00 IST
    await AttendanceService.clockIn(await ref(inA.id), {});
    setNow("2026-10-01T20:30:00.000Z"); // 02:00 IST next day
    const day = await AttendanceService.clockOut(await ref(inA.id));
    expect(day.date).toBe("2026-10-01");
    expect(day.clockOut).toBe("2026-10-01T20:30:00.000Z");
  });

  it("does not treat a forgotten clock-out from long ago as a shift in progress", async () => {
    await AttendanceService.clockIn(await ref(inA.id), {});
    setNow("2026-10-02T14:00:00.000Z");
    expect((await AttendanceService.clockIn(await ref(inA.id), {})).date).toBe("2026-10-02");
  });

  it("refuses someone whose record is not active, and a store that is not theirs", async () => {
    await EmployeeService.update(inA.id, null, w.hr, { status: "on_leave" });
    await refused(AttendanceService.clockIn(await ref(inA.id), {}), 403, /not active/);
    await refused(AttendanceService.clockIn(await ref(inA2.id), { storeId: w.storeB.id }), 400, /own store/);
    await refused(AttendanceService.clockIn(await ref(inA2.id), { storeId: "nope" }), 400, /valid id/);
  });

  it("lets a rider with no store say where they clocked in, and checks the store exists", async () => {
    const rider = await hire(w.hr, { employeeType: "rider", role: "Rider" });
    await refused(AttendanceService.clockIn(await ref(rider.id), { storeId: "11111111-1111-4111-8111-111111111111" }), 400, /does not exist/);
    await AttendanceService.clockIn(await ref(rider.id), { storeId: w.storeB.id });
    expect([...state.attendance.values()][0].storeId).toBe(w.storeB.id);
  });
});

// ================================================================ the day view
describe("who is in today", () => {
  it("derives present, late, absent, on leave and off from records, leave and holidays", async () => {
    const third = await hire(w.hr, { storeId: w.storeA.id, name: "Dev" });
    const fourth = await hire(w.hr, { storeId: w.storeB.id, name: "Esha" });
    await AttendanceService.clockIn(await ref(inA.id), {});
    const request = await requestLeave(inA2.id, { from: TODAY, to: "2026-10-02" });
    await approve(request.id);
    await HolidayService.create({ date: TODAY, name: "Store day", type: "store", storeIds: [w.storeB.id] });

    const view = await AttendanceService.getForDay(asHr(), { date: TODAY });
    const status = Object.fromEntries(view.people.map((p) => [p.name, p.status]));
    expect(status).toEqual({ Asha: "present", Bina: "on_leave", Chetan: "off", Dev: "absent", Esha: "off" });
    expect(view.total).toBe(5);
    expect(third.id).toBeDefined();
    expect(fourth.id).toBeDefined();
  });

  it("shows a manager only their own store and refuses a store they do not own", async () => {
    const view = await AttendanceService.getForDay(asManagerA(), { date: TODAY });
    expect(view.people.map((p) => p.name)).toEqual(["Asha", "Bina"]);
    await refused(AttendanceService.getForDay(asManagerA(), { date: TODAY, storeId: w.storeB.id }), 404);
  });

  it("does not list people who had not joined or who had already left", async () => {
    await EmployeeService.deactivate(inA2.id, null, w.hr, { lastWorkingDay: "2026-09-20" });
    await hire(w.hr, { storeId: w.storeA.id, name: "Future", joinDate: "2026-10-20" });
    const names = (await AttendanceService.getForDay(asHr(), { date: TODAY })).people.map((p) => p.name);
    expect(names).toEqual(["Asha", "Chetan"]);
    const past = (await AttendanceService.getForDay(asHr(), { date: "2026-09-10" })).people.map((p) => p.name);
    expect(past).toContain("Bina");
  });

  it("refuses a missing, malformed or future date and pages the answer", async () => {
    await refused(AttendanceService.getForDay(asHr(), {}), 400, /date must be a date/);
    await refused(AttendanceService.getForDay(asHr(), { date: "01/10/2026" }), 400, /date must be a date/);
    await refused(AttendanceService.getForDay(asHr(), { date: "2026-10-02" }), 400, /future/);
    const paged = await AttendanceService.getForDay(asHr(), { date: TODAY, limit: "2", page: "2" });
    expect(paged).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(paged.people).toHaveLength(1);
  });
});

// ================================================================ corrections
describe("attendance corrections", () => {
  const correct = (over: Record<string, unknown> = {}, scope = asHr()) =>
    AttendanceService.createCorrection(scope, w.hr, {
      employeeId: inA.id,
      date: "2026-09-29",
      clockIn: "2026-09-29T03:30:00.000Z",
      reason: "Forgot to clock in",
      ...over,
    });

  it("creates the missing day and audits it with who, why and the before and after", async () => {
    const result = await correct();
    expect(result).toMatchObject({ date: "2026-09-29", reason: "Forgot to clock in", previousClockIn: null, clockIn: "2026-09-29T03:30:00.000Z", status: "present" });
    expect(state.attendance.size).toBe(1);
    expect(state.corrections).toHaveLength(1);
    expect(state.corrections[0].correctedByName).toBe("HR");
  });

  it("appends to the audit instead of overwriting it when the same day is corrected again", async () => {
    await correct();
    const first = { ...state.corrections[0] };
    await correct({ clockIn: undefined, clockOut: "2026-09-29T12:00:00.000Z", reason: "Forgot to clock out" });
    expect(state.corrections).toHaveLength(2);
    expect(state.corrections[0]).toEqual(first);
    expect(state.corrections[1]).toMatchObject({ previousClockIn: first.newClockIn, previousClockOut: null, newClockOut: new Date("2026-09-29T12:00:00.000Z") });
    expect([...state.attendance.values()][0].corrected).toBe(true);
  });

  it("marks a corrected day late when the roster says the clock-in was late", async () => {
    await RosterService.create(asHr(), w.hr, { employeeId: inA.id, storeId: w.storeA.id, date: "2026-09-29", shiftStart: "09:00", shiftEnd: "17:00" });
    expect((await correct({ clockIn: "2026-09-29T04:30:00.000Z" })).status).toBe("late");
  });

  it.each([
    ["no reason", { reason: "" }, /reason is required/],
    ["neither time", { clockIn: undefined }, /clockIn, a clockOut/],
    ["a clock-out before the clock-in", { clockOut: "2026-09-29T03:00:00.000Z" }, /after clockIn/],
    ["a clock-in on another day", { clockIn: "2026-09-28T03:30:00.000Z" }, /fall on the corrected date/],
    ["a shift over twenty hours", { clockOut: "2026-09-30T03:35:00.000Z" }, /longer than 20 hours/],
    ["a future date", { date: "2026-10-02", clockIn: "2026-10-02T03:30:00.000Z" }, /future/],
    ["a date before joining", { date: "2025-12-31", clockIn: "2025-12-31T03:30:00.000Z" }, /before the employee joined/],
    ["a clock-out in the future", { clockOut: "2026-10-01T09:00:00.000Z", date: TODAY, clockIn: "2026-10-01T03:30:00.000Z" }, /clockOut cannot be in the future/],
    ["an unknown employee id", { employeeId: "nope" }, /employeeId must be a valid id/],
    ["a malformed instant", { clockIn: "yesterday" }, /ISO date and time/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(correct(over), 400, message);
    expect(state.attendance.size).toBe(0);
    expect(state.corrections).toHaveLength(0);
  });

  it("refuses a correction that changes nothing", async () => {
    await correct();
    await refused(correct({ reason: "again" }), 400, /already what is recorded/);
    expect(state.corrections).toHaveLength(1);
  });

  it("answers 404 for an employee outside the store the admin is looking at, or a stranger", async () => {
    await refused(correct({}, w.storeB.id), 404);
    await refused(correct({ employeeId: "11111111-1111-4111-8111-111111111111" }), 404);
  });

  it("rolls the day back when the audit row cannot be written", async () => {
    const { attendanceQuery } = require("../Testing/InMemoryHr.js");
    jest.spyOn(attendanceQuery, "createCorrection").mockRejectedValueOnce(new Error("disk full"));
    await refused(correct(), 500);
    expect(state.attendance.size).toBe(0);
  });

  it("lists corrections newest day first, filtered and scoped", async () => {
    await correct();
    await correct({ employeeId: inB.id, date: "2026-09-30", clockIn: "2026-09-30T03:30:00.000Z" });
    expect((await AttendanceService.listCorrections(asHr(), {})).total).toBe(2);
    expect((await AttendanceService.listCorrections(asHr(), { employeeId: inB.id })).items).toHaveLength(1);
    expect((await AttendanceService.listCorrections(asHr(), { from: "2026-09-30" })).items[0].date).toBe("2026-09-30");
    expect((await AttendanceService.listCorrections(w.storeA.id, {})).items).toHaveLength(1);
    await refused(AttendanceService.listCorrections(asHr(), { from: "2026-10-01", to: "2026-09-01" }), 400, /from must not be after to/);
    await refused(AttendanceService.listCorrections(asHr(), { employeeId: "x" }), 400);
  });
});

// ================================================================ summary and month
describe("attendance summary", () => {
  const range = { from: "2026-09-28", to: TODAY };

  beforeEach(async () => {
    await RosterService.create(asHr(), w.hr, { employeeId: inA.id, storeId: w.storeA.id, date: "2026-09-29", shiftStart: "09:00", shiftEnd: "17:00" });
    const at = (date: string, instant: string) =>
      AttendanceService.createCorrection(asHr(), w.hr, { employeeId: inA.id, date, clockIn: instant, reason: "load" });
    await at("2026-09-28", "2026-09-28T04:00:00.000Z");
    await at("2026-09-29", "2026-09-29T04:30:00.000Z");
    await approve((await requestLeave(inA.id, { from: "2026-09-30", to: "2026-09-30" })).id);
  });

  it("counts present, late, leave and absent days and the rate over the working days", async () => {
    const row = (await AttendanceService.getSummary(asHr(), { ...range, storeId: w.storeA.id })).employees.find((e) => e.name === "Asha");
    expect(row).toMatchObject({ present: 1, late: 1, leave: 1, absent: 1, workingDays: 4, attendanceRatePct: 50 });
  });

  it("does not count a holiday as absent and raises the rate accordingly", async () => {
    await HolidayService.create({ date: TODAY, name: "Founders day" });
    const row = (await AttendanceService.getSummary(asHr(), range)).employees.find((e) => e.name === "Asha");
    expect(row).toMatchObject({ absent: 0, workingDays: 3, attendanceRatePct: 66.7 });
  });

  it("only counts the days someone was on the books", async () => {
    const later = await hire(w.hr, { storeId: w.storeA.id, name: "Late joiner", joinDate: "2026-09-30" });
    const row = (await AttendanceService.getSummary(asHr(), range)).employees.find((e) => e.name === "Late joiner");
    expect(row).toMatchObject({ workingDays: 2, absent: 2 });
    expect(later.id).toBeDefined();
  });

  it("is scoped to a manager's store, bounded to 92 days, and rejects a backwards range", async () => {
    expect((await AttendanceService.getSummary(asManagerA(), range)).employees.map((e) => e.name)).toEqual(["Asha", "Bina"]);
    await refused(AttendanceService.getSummary(asHr(), { from: "2026-01-01", to: TODAY }), 400, /at most 92 days/);
    await refused(AttendanceService.getSummary(asHr(), { from: TODAY, to: "2026-09-01" }), 400, /from must not be after to/);
    await refused(AttendanceService.getSummary(asManagerA(), { storeId: w.storeB.id }), 404);
  });

  it("gives one person's month day by day, up to today only", async () => {
    const month = await AttendanceService.getEmployeeMonth(inA.id, asHr(), { month: "2026-09" });
    expect(month.days).toHaveLength(30);
    expect(month.days.find((d) => d.date === "2026-09-29")).toMatchObject({ status: "late" });
    expect(month.days.find((d) => d.date === "2026-09-30")).toMatchObject({ status: "on_leave" });
    const current = await AttendanceService.getEmployeeMonth(inA.id, asHr(), {});
    expect(current.days.at(-1)?.date).toBe(TODAY);
    await refused(AttendanceService.getEmployeeMonth(inA.id, asHr(), { month: "2026-13" }), 400, /month must be/);
    await refused(AttendanceService.getEmployeeMonth(inB.id, asManagerA(), {}), 404);
    await refused(AttendanceService.getEmployeeMonth("nope", asHr(), {}), 404);
  });
});

// ================================================================ rosters
describe("rosters", () => {
  const roster = (over: Record<string, unknown> = {}, scope = asHr(), user = w.hr) =>
    RosterService.create(scope, user, { employeeId: inA.id, storeId: w.storeA.id, date: "2026-10-02", shiftStart: "09:00", shiftEnd: "13:00", ...over });

  it("creates a shift and lists it with times as HH:MM", async () => {
    const entry = await roster();
    expect(entry).toMatchObject({ date: "2026-10-02", shiftStart: "09:00", shiftEnd: "13:00" });
    expect((await RosterService.list(asHr(), { from: "2026-10-01", to: "2026-10-05" })).items).toHaveLength(1);
  });

  it("refuses overlapping shifts for one person but allows back-to-back ones", async () => {
    await roster();
    await refused(roster({ shiftStart: "12:00", shiftEnd: "16:00" }), 409, /overlapping shift/);
    await roster({ shiftStart: "13:00", shiftEnd: "17:00" });
    expect(state.rosters.size).toBe(2);
  });

  it("lets only one of two simultaneous overlapping shifts in", async () => {
    const results = await Promise.allSettled([roster(), roster({ shiftStart: "10:00", shiftEnd: "14:00" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.rosters.size).toBe(1);
  });

  it.each([
    ["an end before the start", { shiftEnd: "08:00" }, /shiftEnd must be after/],
    ["an equal start and end", { shiftEnd: "09:00" }, /shiftEnd must be after/],
    ["a malformed time", { shiftStart: "9am" }, /shiftStart must be a time/],
    ["a date too far back", { date: "2026-09-01" }, /within 7 days back/],
    ["a date too far ahead", { date: "2027-06-01" }, /180 days ahead/],
    ["a missing employee", { employeeId: undefined }, /employeeId must be a valid id/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(roster(over), 400, message);
  });

  it("refuses an employee who belongs to another store, or who has left", async () => {
    await refused(roster({ employeeId: inB.id }), 400, /another store/);
    await EmployeeService.deactivate(inA2.id, null, w.hr, { lastWorkingDay: "2026-09-20" });
    await refused(roster({ employeeId: inA2.id }), 400, /has left/);
  });

  it("answers 404 when a manager touches another store or another store's people", async () => {
    await refused(roster({ storeId: w.storeB.id, employeeId: inB.id }, asManagerA(), w.managerA), 404);
    await refused(roster({ employeeId: inB.id }, asManagerA(), w.managerA), 404);
    const own = await roster({}, asManagerA(), w.managerA);
    expect(own.storeId).toBe(w.storeA.id);
  });

  it("deletes a shift, and a manager cannot delete another store's", async () => {
    const entry = await roster();
    const other = await roster({ employeeId: inB.id, storeId: w.storeB.id });
    await refused(RosterService.remove(other.id, asManagerA()), 404);
    expect(await RosterService.remove(entry.id, asManagerA())).toEqual({ id: entry.id, removed: true });
    await refused(RosterService.remove(entry.id, asHr()), 404);
    await refused(RosterService.remove("nope", asHr()), 404);
  });

  it("measures coverage against what the same shift usually has on that weekday", async () => {
    const lastWeek = "2026-09-24";
    await roster({ employeeId: inA.id, date: lastWeek, shiftStart: "09:00", shiftEnd: "17:00" });
    await roster({ employeeId: inA2.id, date: lastWeek, shiftStart: "09:00", shiftEnd: "17:00" });
    await roster({ employeeId: inA2.id, date: lastWeek, shiftStart: "18:00", shiftEnd: "22:00" });
    await roster({ employeeId: inA.id, date: TODAY, shiftStart: "09:00", shiftEnd: "17:00" });
    const { shifts } = await RosterService.coverage(asHr(), { storeId: w.storeA.id, date: TODAY });
    expect(shifts).toEqual([
      { start: "09:00", end: "17:00", rostered: 1, required: 2, gap: 1 },
      { start: "18:00", end: "22:00", rostered: 0, required: 1, gap: 1 },
    ]);
  });

  it("treats a shift with no history as fully covered, and checks the store", async () => {
    await roster({ date: TODAY, shiftStart: "09:00", shiftEnd: "17:00" });
    const { shifts } = await RosterService.coverage(asHr(), { storeId: w.storeA.id, date: TODAY });
    expect(shifts).toEqual([{ start: "09:00", end: "17:00", rostered: 1, required: 1, gap: 0 }]);
    await refused(RosterService.coverage(asManagerA(), { storeId: w.storeB.id, date: TODAY }), 404);
    await refused(RosterService.coverage(asHr(), { date: TODAY }), 400, /storeId must be a valid id/);
    await refused(RosterService.coverage(asHr(), { storeId: w.storeA.id }), 400, /date must be a date/);
  });

  it("bounds the listed range", async () => {
    await refused(RosterService.list(asHr(), { from: "2026-01-01", to: "2026-12-31" }), 400, /at most 62 days/);
  });
});

// ================================================================ holidays
describe("holidays", () => {
  it("creates general and store holidays, and refuses duplicates and bad store lists", async () => {
    await HolidayService.create({ date: "2026-10-20", name: "Diwali" });
    await refused(HolidayService.create({ date: "2026-10-20", name: "Diwali" }), 409, /already on the calendar/);
    await refused(HolidayService.create({ date: "2026-10-21", name: "Local", type: "store" }), 400, /storeIds must list/);
    await refused(HolidayService.create({ date: "2026-10-21", name: "Local", type: "store", storeIds: ["11111111-1111-4111-8111-111111111111"] }), 400, /does not exist/);
    await refused(HolidayService.create({ date: "2026-10-21", name: "General", storeIds: [w.storeA.id] }), 400, /only applies to a store holiday/);
    await refused(HolidayService.create({ date: "2026-10-21", name: "x", type: "bank" }), 400, /type must be one of/);
    await refused(HolidayService.create({ name: "No date" }), 400, /date must be a date/);
  });

  it("shows each audience the holidays that concern it", async () => {
    await HolidayService.create({ date: "2026-10-20", name: "Diwali" });
    await HolidayService.create({ date: "2026-10-22", name: "Store A day", type: "store", storeIds: [w.storeA.id] });
    await HolidayService.create({ date: "2026-10-23", name: "Store B day", type: "store", storeIds: [w.storeB.id] });
    const names = async (user: any, query: any = {}) => (await HolidayService.list(user, query)).items.map((h) => h.name);
    expect(await names(w.hr)).toEqual(["Diwali", "Store A day", "Store B day"]);
    expect(await names(w.hr, { storeId: w.storeB.id })).toEqual(["Diwali", "Store B day"]);
    expect(await names(w.managerA)).toEqual(["Diwali", "Store A day"]);
    expect(await names(w.managerA, { storeId: w.storeB.id })).toEqual(["Diwali", "Store A day"]);
    expect(await names(actor("staff", w.storeB.id))).toEqual(["Diwali", "Store B day"]);
    expect(await names(actor("driver"))).toEqual(["Diwali"]);
    expect(await names(actor("driver", w.storeA.id))).toEqual(["Diwali", "Store A day"]);
  });

  it("lists by year, bounds the year and pages", async () => {
    await HolidayService.create({ date: "2027-01-26", name: "Republic day" });
    expect((await HolidayService.list(w.hr, {})).total).toBe(0);
    expect((await HolidayService.list(w.hr, { year: "2027" })).items).toHaveLength(1);
    await refused(HolidayService.list(w.hr, { year: "1900" }), 400, /year must be/);
    await refused(HolidayService.list(w.hr, { page: "x" }), 400);
  });

  it("removes a holiday and answers 404 for an unknown one", async () => {
    const holiday = await HolidayService.create({ date: "2026-10-20", name: "Diwali" });
    expect(await HolidayService.remove(holiday.id)).toEqual({ id: holiday.id, removed: true });
    await refused(HolidayService.remove(holiday.id), 404);
    await refused(HolidayService.remove("nope"), 404);
  });
});

// ================================================================ leave requests
describe("asking for leave", () => {
  it("creates a pending request that counts only chargeable days", async () => {
    await HolidayService.create({ date: "2026-10-06", name: "Local holiday" });
    const request = await requestLeave(inA.id, { reason: "Family" });
    expect(request).toMatchObject({ status: "pending", from: "2026-10-05", to: "2026-10-07", days: 2, reason: "Family", employeeName: "Asha" });
  });

  it("counts a half-day as half a day and refuses a half-day over several dates", async () => {
    expect((await requestLeave(inA.id, { from: "2026-10-05", to: "2026-10-05", halfDay: true })).days).toBe(0.5);
    await refused(requestLeave(inA2.id, { halfDay: true }), 400, /single day/);
    await refused(requestLeave(inA2.id, { from: "2026-10-05", to: "2026-10-05", halfDay: "yes" }), 400, /true or false/);
  });

  it("refuses a request that is only holidays", async () => {
    await HolidayService.create({ date: "2026-10-06", name: "Local holiday" });
    await refused(requestLeave(inA.id, { from: "2026-10-06", to: "2026-10-06" }), 400, /all holidays/);
  });

  it.each([
    ["an unknown type", { type: "sabbatical" }, /type must be one of/],
    ["an end before the start", { from: "2026-10-08", to: "2026-10-05" }, /from must not be after to/],
    ["a malformed date", { from: "5 Oct" }, /from must be a date/],
    ["more than sixty days", { from: "2026-10-05", to: "2026-12-30" }, /at most 60 days/],
    ["leave that started over thirty days ago", { from: "2026-08-01", to: "2026-08-02" }, /30 days back/],
    ["leave more than a year ahead", { from: "2027-11-01", to: "2027-11-02" }, /within a year/],
    ["leave before joining", { from: "2025-12-30", to: "2026-01-02", __: 1 }, /before the join date|30 days back/],
    ["an over-long reason", { reason: "x".repeat(301) }, /at most 300/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(requestLeave(inA.id, over), 400, message);
    expect(state.requests.size).toBe(0);
  });

  it("refuses leave starting before the join date", async () => {
    const fresh = await hire(w.hr, { storeId: w.storeA.id, joinDate: "2026-09-25" });
    await refused(requestLeave(fresh.id, { from: "2026-09-20", to: "2026-09-21" }), 400, /before the join date/);
  });

  it("refuses someone who has left", async () => {
    const gone = await ref(inA2.id);
    await EmployeeService.deactivate(inA2.id, null, w.hr, { lastWorkingDay: "2026-09-20" });
    await refused(LeaveService.createRequest({ ...gone, status: "exited" }, { type: "casual", from: "2026-10-05", to: "2026-10-05" }), 403);
  });

  it("refuses overlapping requests while one is pending or approved, but not after it is withdrawn or rejected", async () => {
    const first = await requestLeave(inA.id);
    await refused(requestLeave(inA.id, { from: "2026-10-07", to: "2026-10-09" }), 409, /already have leave/);
    await LeaveService.withdraw(await ref(inA.id), first.id);
    const second = await requestLeave(inA.id, { from: "2026-10-07", to: "2026-10-09" });
    await LeaveService.reject(second.id, asHr(), w.hr, { reason: "Busy week" });
    expect((await requestLeave(inA.id)).status).toBe("pending");
  });

  it("lets only one of two simultaneous overlapping submissions in", async () => {
    const me = await ref(inA.id);
    const body = { type: "casual", from: "2026-10-05", to: "2026-10-06" };
    const results = await Promise.allSettled([LeaveService.createRequest(me, body), LeaveService.createRequest(me, body)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.requests.size).toBe(1);
  });

  it("lets only the owner withdraw, and only while it is pending", async () => {
    const request = await requestLeave(inA.id);
    await refused(LeaveService.withdraw(await ref(inA2.id), request.id), 404);
    await approve(request.id);
    await refused(LeaveService.withdraw(await ref(inA.id), request.id), 409, /already approved/);
    const another = await requestLeave(inA.id, { from: "2026-11-02", to: "2026-11-02" });
    expect((await LeaveService.withdraw(await ref(inA.id), another.id)).status).toBe("withdrawn");
    await refused(LeaveService.withdraw(await ref(inA.id), "nope"), 404);
  });
});

// ================================================================ deciding leave
describe("deciding leave", () => {
  it("approves, takes the days off the balance and writes a ledger line, all together", async () => {
    const request = await requestLeave(inA.id);
    const approved = await approve(request.id);
    expect(approved).toMatchObject({ status: "approved", days: 3, decidedBy: "HR" });
    const [balance] = leaveRows();
    expect(balance).toMatchObject({ entitledHalfDays: 24, takenHalfDays: 6, year: 2026 });
    expect(state.ledger.filter((l) => l.kind === "debit")).toEqual([
      expect.objectContaining({ requestId: request.id, deltaHalfDays: -6, year: 2026 }),
    ]);
    expect(state.ledger.filter((l) => l.kind === "grant")).toHaveLength(1);
  });

  it("refuses when the balance is too small and leaves the request pending with nothing written", async () => {
    const request = await requestLeave(inA.id, { from: "2026-10-05", to: "2026-10-18" });
    await refused(approve(request.id), 409, /Not enough casual leave for 2026: 12 day\(s\) left, 14 requested/);
    expect(state.requests.get(request.id).status).toBe("pending");
    expect(state.balances.size).toBe(0);
    expect(state.ledger).toHaveLength(0);
  });

  it("rolls the whole decision back when the ledger cannot be written", async () => {
    const request = await requestLeave(inA.id);
    state.failNextLedger = true;
    await refused(approve(request.id), 500);
    expect(state.requests.get(request.id).status).toBe("pending");
    expect(state.balances.size).toBe(0);
    expect(state.ledger).toHaveLength(0);
    expect((await approve(request.id)).status).toBe("approved");
  });

  it("never lets two simultaneous approvals overspend one balance", async () => {
    const one = await requestLeave(inA.id, { from: "2026-10-05", to: "2026-10-11" });
    const two = await requestLeave(inA.id, { from: "2026-10-12", to: "2026-10-18" });
    const results = await Promise.allSettled([approve(one.id), approve(two.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason.errorCode).toBe(409);
    expect(failure.reason.displayMessage).toMatch(/Not enough casual leave/);
    const [balance] = leaveRows();
    expect(balance.takenHalfDays).toBeLessThanOrEqual(balance.entitledHalfDays);
    expect(balance.takenHalfDays).toBe(14);
    expect(state.ledger.filter((l) => l.kind === "debit")).toHaveLength(1);
  });

  it("never overspends an existing balance when approvals race (the balance row lock, not the creation)", async () => {
    await approve((await requestLeave(inA.id, { from: "2026-10-01", to: "2026-10-01" })).id);
    const one = await requestLeave(inA.id, { from: "2026-10-05", to: "2026-10-11" });
    const two = await requestLeave(inA.id, { from: "2026-10-12", to: "2026-10-18" });
    const three = await requestLeave(inA.id, { from: "2026-10-19", to: "2026-10-25" });
    const results = await Promise.allSettled([approve(one.id), approve(two.id), approve(three.id)]);
    // 12 days minus the 1 already taken leaves 11: exactly one 7-day request fits.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // The losers get a clean refusal from the service, not a constraint error from the database.
    for (const loser of results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]) {
      expect(loser.reason.errorCode).toBe(409);
      expect(loser.reason.displayMessage).toMatch(/Not enough casual leave/);
    }
    const [balance] = leaveRows();
    expect(balance.takenHalfDays).toBe(2 + 14);
    expect(balance.takenHalfDays).toBeLessThanOrEqual(balance.entitledHalfDays);
  });

  it("debits once when the same request is approved twice at the same moment", async () => {
    const request = await requestLeave(inA.id);
    const results = await Promise.allSettled([approve(request.id), approve(request.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.displayMessage).toMatch(/already approved/);
    expect(leaveRows()[0].takenHalfDays).toBe(6);
    expect(state.ledger.filter((l) => l.kind === "debit")).toHaveLength(1);
  });

  it("splits a request across two calendar years and debits each year", async () => {
    const request = await requestLeave(inA.id, { from: "2026-12-30", to: "2027-01-02" });
    await approve(request.id);
    const byYear = Object.fromEntries(leaveRows().map((b) => [b.year, b.takenHalfDays]));
    expect(byYear).toEqual({ 2026: 4, 2027: 4 });
  });

  it("does not charge holidays and does not limit unpaid leave", async () => {
    await HolidayService.create({ date: "2026-10-06", name: "Local holiday" });
    const request = await requestLeave(inA.id, { type: "unpaid", from: "2026-10-05", to: "2026-10-07" });
    const approved = await approve(request.id);
    expect(approved.days).toBe(2);
    expect(state.balances.size).toBe(0);
    const long = await requestLeave(inA2.id, { type: "unpaid", from: "2026-10-05", to: "2026-11-20" });
    expect((await approve(long.id)).status).toBe("approved");
  });

  it("carries last year's unused earned leave forward, but not casual leave", async () => {
    const veteran = await hire(w.hr, { storeId: w.storeA.id, joinDate: "2025-01-01", name: "Veteran" });
    await approve((await requestLeave(veteran.id, { type: "earned", from: "2026-10-05", to: "2026-10-05" })).id);
    await approve((await requestLeave(veteran.id, { type: "casual", from: "2026-10-12", to: "2026-10-12" })).id);
    const rows = leaveRows("earned").concat(leaveRows("casual")).filter((b) => b.employeeId === veteran.id);
    expect(Object.fromEntries(rows.map((b) => [b.type, b.entitledHalfDays]))).toEqual({ earned: 60, casual: 24 });
  });

  it("keeps the ledger append-only: grants and debits are only ever added", async () => {
    await approve((await requestLeave(inA.id)).id);
    const before = JSON.stringify(state.ledger);
    await approve((await requestLeave(inA.id, { from: "2026-10-12", to: "2026-10-12" })).id);
    expect(JSON.stringify(state.ledger).startsWith(before.slice(0, -1))).toBe(true);
    expect(state.ledger).toHaveLength(3);
  });

  it("rejects with a reason and never touches the balance", async () => {
    const request = await requestLeave(inA.id);
    await refused(LeaveService.reject(request.id, asHr(), w.hr, {}), 400, /reason is required/);
    const rejected = await LeaveService.reject(request.id, asHr(), w.hr, { reason: "Peak week" });
    expect(rejected).toMatchObject({ status: "rejected", decisionNote: "Peak week" });
    expect(state.balances.size).toBe(0);
    await refused(approve(request.id), 409, /already rejected/);
    await refused(LeaveService.reject(request.id, asHr(), w.hr, { reason: "again" }), 409, /already rejected/);
  });

  it("lets a manager decide for their own store only, answering 404 for another", async () => {
    const mine = await requestLeave(inA.id);
    const theirs = await requestLeave(inB.id);
    expect((await approve(mine.id, w.managerA, asManagerA())).status).toBe("approved");
    await refused(approve(theirs.id, w.managerA, asManagerA()), 404);
    await refused(LeaveService.reject(theirs.id, asManagerA(), w.managerA, { reason: "no" }), 404);
    await refused(LeaveService.getById(theirs.id, asManagerA()), 404);
    expect(state.requests.get(theirs.id).status).toBe("pending");
  });

  it("never lets anyone decide their own request", async () => {
    const loginId = "7d2f8d58-5c36-4d3c-9d1a-0a3b8a6a9999";
    const boss = await hire(w.hr, { employeeType: "manager", storeId: w.storeA.id, gatewayUserId: loginId, name: "Boss" });
    const own = actor("manager", w.storeA.id, null, loginId);
    const request = await requestLeave(boss.id);
    await refused(approve(request.id, own, scopeOf(own)), 403, /own leave request/);
    await refused(LeaveService.reject(request.id, scopeOf(own), own, { reason: "no" }), 403, /own leave request/);
    expect((await approve(request.id)).status).toBe("approved");
  });

  it("refuses to approve for someone who has left since asking", async () => {
    const request = await requestLeave(inA2.id);
    await EmployeeService.deactivate(inA2.id, null, w.hr, { lastWorkingDay: "2026-09-30" });
    await refused(approve(request.id), 409, /has left/);
  });

  it("answers 404 for unknown requests", async () => {
    await refused(approve("nope"), 404);
    await refused(LeaveService.getById("nope", asHr()), 404);
    await refused(approve("11111111-1111-4111-8111-111111111111"), 404);
  });
});

// ================================================================ leave reads
describe("leave lists, balances and policies", () => {
  it("lists requests newest first, filtered and scoped, and counts the pending ones", async () => {
    const a = await requestLeave(inA.id);
    await requestLeave(inB.id);
    await approve(a.id);
    expect((await LeaveService.list(asHr(), {})).total).toBe(2);
    expect((await LeaveService.list(asHr(), { status: "approved" })).items.map((r) => r.employeeName)).toEqual(["Asha"]);
    expect((await LeaveService.list(asManagerA(), {})).items.map((r) => r.employeeName)).toEqual(["Asha"]);
    expect((await LeaveService.list(asHr(), { employeeId: inB.id })).total).toBe(1);
    expect((await LeaveService.list(asHr(), { from: "2026-10-08" })).total).toBe(0);
    expect((await LeaveService.list(asHr(), { to: "2026-10-05" })).total).toBe(2);
    expect(await LeaveService.countPending(asHr())).toEqual({ pending: 1 });
    expect(await LeaveService.countPending(asManagerA())).toEqual({ pending: 0 });
    await refused(LeaveService.list(asHr(), { status: "maybe" }), 400, /status must be one of/);
    await refused(LeaveService.list(asHr(), { employeeId: "x" }), 400);
    await refused(LeaveService.list(asManagerA(), { storeId: w.storeB.id }), 404);
  });

  it("shows the calendar of approved leave for a month", async () => {
    await approve((await requestLeave(inA.id)).id);
    await requestLeave(inA2.id);
    const calendar = await LeaveService.calendar(asHr(), { month: "2026-10" });
    expect(calendar.entries).toEqual([{ employeeId: inA.id, name: "Asha", from: "2026-10-05", to: "2026-10-07", type: "casual" }]);
    expect((await LeaveService.calendar(asHr(), { month: "2026-11" })).entries).toEqual([]);
    expect((await LeaveService.calendar(asManagerA(), { month: "2026-10" })).entries).toHaveLength(1);
    await refused(LeaveService.calendar(asHr(), {}), 400, /month must be/);
  });

  it("projects every balance from the policy, then reflects what was taken", async () => {
    await approve((await requestLeave(inA.id)).id);
    const page = await LeaveService.listBalances(asHr(), { employeeId: inA.id });
    const casual = page.balances.find((b) => b.type === "casual");
    expect(casual).toMatchObject({ entitled: 12, taken: 3, remaining: 9 });
    expect(page.balances.map((b) => b.type).sort()).toEqual(["casual", "earned", "other", "sick"]);
    expect(page.utilisationPct).toBeCloseTo((3 / (12 + 15 + 12 + 3)) * 100, 0);
    const everyone = await LeaveService.listBalances(asHr(), {});
    expect(everyone.total).toBe(3);
    await refused(LeaveService.listBalances(asManagerA(), { employeeId: inB.id }), 404);
  });

  it("gives one employee's balances for self-service", async () => {
    const mine = await LeaveService.balancesFor(state.employees.get(inA.id));
    expect(mine.find((b) => b.type === "sick")).toEqual({ type: "sick", entitled: 12, taken: 0, remaining: 12 });
  });

  it("reads and sets policies in half-day steps and validates them", async () => {
    expect((await LeaveService.getPolicies()).policies.find((p) => p.type === "earned")).toEqual({ type: "earned", annualDays: 15, carryForward: true });
    const set = await LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 10.5, carryForward: true }] });
    expect(set.policies.find((p) => p.type === "casual")).toEqual({ type: "casual", annualDays: 10.5, carryForward: true });
    expect(set.policies).toHaveLength(5);
    await refused(LeaveService.setPolicies({ policies: [] }), 400, /one entry per leave type/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 1 }, { type: "casual", annualDays: 2 }] }), 400, /listed twice/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: -1 }] }), 400, /annualDays must be/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 1.25 }] }), 400, /half a day/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 400 }] }), 400, /annualDays must be/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "holiday", annualDays: 1 }] }), 400, /type must be one of/);
    await refused(LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 1, carryForward: "yes" }] }), 400, /true or false/);
  });

  it("applies a changed policy to balances not yet created, not to existing ones", async () => {
    await approve((await requestLeave(inA.id)).id);
    await LeaveService.setPolicies({ policies: [{ type: "casual", annualDays: 20 }] });
    await approve((await requestLeave(inA.id, { from: "2026-10-12", to: "2026-10-12" })).id);
    expect(leaveRows().find((b) => b.employeeId === inA.id)?.entitledHalfDays).toBe(24);
    await approve((await requestLeave(inA2.id)).id);
    expect(leaveRows().find((b) => b.employeeId === inA2.id)?.entitledHalfDays).toBe(40);
  });
});

// ================================================================ career
describe("career plans, history and paths", () => {
  it("returns an empty plan with the employee's history", async () => {
    await EmployeeService.update(inA.id, null, w.hr, { designation: "Supervisor", payGrade: "G2" });
    const plan = await CareerService.getPlan(inA.id, null);
    expect(plan).toMatchObject({ targetRole: null, goals: [], skillGaps: [], agreedActions: [], lastReviewedAt: null });
    expect(plan.history.map((h) => h.field)).toEqual(expect.arrayContaining(["designation", "pay_grade", "role", "store"]));
    expect(plan.history.some((h) => h.field === "designation" && h.to === "Supervisor")).toBe(true);
  });

  it("sets a plan and keeps the fields that were not sent", async () => {
    await CareerService.setPlan(inA.id, null, {
      targetRole: "Supervisor",
      goals: [{ title: "Learn pressing", targetDate: "2026-12-01" }],
      skillGaps: ["Pressing"],
    });
    const updated = await CareerService.setPlan(inA.id, null, { agreedActions: [{ action: "Shadow a supervisor", owner: "Meera", dueDate: "2026-11-01" }] });
    expect(updated).toMatchObject({
      targetRole: "Supervisor",
      goals: [{ title: "Learn pressing", targetDate: "2026-12-01", status: "planned" }],
      skillGaps: ["Pressing"],
      agreedActions: [{ action: "Shadow a supervisor", owner: "Meera", dueDate: "2026-11-01" }],
    });
    expect((await CareerService.setPlan(inA.id, null, { targetRole: null })).targetRole).toBeNull();
  });

  it.each([
    ["goals that are not a list", { goals: "x" }, /goals must be a list/],
    ["a goal with no title", { goals: [{ status: "planned" }] }, /goals.title is required/],
    ["a goal with a bad status", { goals: [{ title: "x", status: "dreaming" }] }, /goals.status must be one of/],
    ["a goal with a bad date", { goals: [{ title: "x", targetDate: "soon" }] }, /targetDate must be a date/],
    ["too many skill gaps", { skillGaps: Array.from({ length: 21 }, () => "x") }, /at most 20/],
    ["an action with no text", { agreedActions: [{}] }, /agreedActions.action is required/],
  ])("refuses %s", async (_label, body, message) => {
    await refused(CareerService.setPlan(inA.id, null, body), 400, message);
  });

  it("records a review only when there is a plan, with a note", async () => {
    await refused(CareerService.reviewPlan(inA.id, null, w.hr, { note: "Reviewed" }), 404, /no career plan/);
    await CareerService.setPlan(inA.id, null, { targetRole: "Lead" });
    await refused(CareerService.reviewPlan(inA.id, null, w.hr, {}), 400, /note is required/);
    const reviewed = await CareerService.reviewPlan(inA.id, null, w.hr, { note: "On track" });
    expect(reviewed.lastReviewedAt).toBe(FIXED_NOW.toISOString());
    expect(state.reviews).toHaveLength(1);
  });

  it("answers 404 for an employee outside the store scope", async () => {
    await refused(CareerService.getPlan(inB.id, w.storeA.id), 404);
    await refused(CareerService.setPlan(inB.id, w.storeA.id, {}), 404);
    await refused(CareerService.reviewPlan("nope", null, w.hr, { note: "x" }), 404);
  });

  it("defines and lists career paths by normalised role", async () => {
    await CareerService.setPath("Senior  Washer", { nextRoles: ["Supervisor"], requirements: ["1 year"] });
    await CareerService.setPath("washer", { nextRoles: ["Senior washer"] });
    const list = await CareerService.listPaths({});
    expect(list.paths).toEqual([
      { role: "senior washer", nextRoles: ["Supervisor"], requirements: ["1 year"] },
      { role: "washer", nextRoles: ["Senior washer"], requirements: [] },
    ]);
    expect(list.total).toBe(2);
    await refused(CareerService.setPath("   ", { nextRoles: [] }), 400, /role must be/);
    await refused(CareerService.setPath("washer", {}), 400, /nextRoles must be a list/);
  });
});

// ================================================================ daily reports, cover
describe("daily reports", () => {
  const submit = async (employeeId: string, over: Record<string, unknown> = {}) =>
    CoverReportService.submitDaily(await ref(employeeId), { date: TODAY, summary: "Washed and folded", ...over });

  it("records a report once per person per day", async () => {
    const report = await submit(inA.id, { completed: ["Batch 1"], blockers: "Washer 2 broken", hoursWorked: 7.5 });
    expect(report).toMatchObject({ date: TODAY, hoursWorked: 7.5, completed: ["Batch 1"], name: "Asha" });
    await refused(submit(inA.id), 409, /already submitted/);
    expect((await submit(inA.id, { date: "2026-09-30" })).date).toBe("2026-09-30");
  });

  it.each([
    ["no summary", { summary: "" }, /summary is required/],
    ["a future date", { date: "2026-10-02" }, /today or within the last 7 days/],
    ["an old date", { date: "2026-09-01" }, /within the last 7 days/],
    ["impossible hours", { hoursWorked: 30 }, /hoursWorked must be/],
    ["hours as text", { hoursWorked: "eight" }, /hoursWorked must be/],
    ["a long blocker", { blockers: "x".repeat(501) }, /at most 500/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(submit(inA.id, over), 400, message);
  });

  it("lists reports scoped and filtered, and answers 404 for another store's report", async () => {
    const mine = await submit(inA.id);
    const theirs = await submit(inB.id);
    expect((await CoverReportService.listDaily(asHr(), { date: TODAY })).total).toBe(2);
    expect((await CoverReportService.listDaily(asManagerA(), {})).items.map((r) => r.name)).toEqual(["Asha"]);
    expect((await CoverReportService.listDaily(asHr(), { employeeId: inB.id })).items).toHaveLength(1);
    expect((await CoverReportService.listForEmployee(inA.id, {})).items).toHaveLength(1);
    expect((await CoverReportService.getDaily(mine.id, asManagerA())).summary).toBe("Washed and folded");
    await refused(CoverReportService.getDaily(theirs.id, asManagerA()), 404);
    await refused(CoverReportService.getDaily("nope", asHr()), 404);
    await refused(CoverReportService.listDaily(asHr(), { from: "2026-01-01", to: TODAY }), 400, /at most 92 days/);
  });

  it("finds blockers that recur, however they are worded, and ignores one-offs", async () => {
    const third = await hire(w.hr, { storeId: w.storeA.id });
    await submit(inA.id, { blockers: "Washer #2 broken!" });
    await submit(inA2.id, { blockers: "washer 2   BROKEN" });
    await submit(third.id, { blockers: "Washer 2 broken." });
    await submit(inB.id, { blockers: "No detergent" });
    const all = await CoverReportService.patterns(asHr(), {});
    expect(all.recurringBlockers).toEqual([
      { theme: "washer 2 broken", count: 3, examples: expect.arrayContaining(["Washer #2 broken!", "washer 2   BROKEN"]) },
    ]);
    expect(all.recurringBlockers[0].examples.length).toBeLessThanOrEqual(3);
    expect((await CoverReportService.patterns(asManagerA(), { storeId: w.storeA.id })).recurringBlockers).toHaveLength(1);
    await refused(CoverReportService.patterns(asManagerA(), { storeId: w.storeB.id }), 404);
    await refused(CoverReportService.patterns(asHr(), { weeks: "0" }), 400, /weeks must be/);
    await refused(CoverReportService.patterns(asHr(), { weeks: "9" }), 400, /weeks must be/);
  });
});

describe("absence cover", () => {
  it("lists who is absent or on leave, who is in to cover, and says assignments are not tracked", async () => {
    await AttendanceService.clockIn(await ref(inA.id), {});
    await approve((await requestLeave(inA2.id, { from: TODAY, to: TODAY })).id);
    const rider = await hire(w.hr, { storeId: w.storeA.id, name: "Dev", designation: "Presser" });
    const cover = await CoverReportService.absenceCover(asManagerA(), { date: TODAY });
    expect(cover.absent.map((a) => [a.name, a.reason])).toEqual([
      ["Bina", "On approved leave"],
      ["Dev", "No clock-in recorded"],
    ]);
    expect(cover.absent[0].assigned).toEqual({ orders: 0, batches: 0, routes: 0 });
    expect(cover.availableCover).toEqual([{ employeeId: inA.id, name: "Asha", skills: ["Washer"] }]);
    expect(cover.assignmentsTracked).toBe(false);
    expect(rider.id).toBeDefined();
  });

  it("does not show another store's people to a manager, and refuses a future date", async () => {
    await AttendanceService.clockIn(await ref(inB.id), {});
    const cover = await CoverReportService.absenceCover(asManagerA(), { date: TODAY });
    expect(cover.absent.map((a) => a.name)).not.toContain("Chetan");
    expect(cover.availableCover).toEqual([]);
    await refused(CoverReportService.absenceCover(asHr(), { date: "2026-10-05" }), 400, /future/);
    await refused(CoverReportService.absenceCover(asHr(), {}), 400, /date must be a date/);
  });

  describe("handing work over", () => {
    const reassign = (over: Record<string, unknown> = {}, scope = asHr()) =>
      CoverReportService.reassign(scope, w.hr, { fromEmployeeId: inA2.id, toEmployeeId: inA.id, date: TODAY, ...over });

    beforeEach(async () => {
      await AttendanceService.clockIn(await ref(inA.id), {});
    });

    it("records a hand-over from someone absent to someone in", async () => {
      const done = await reassign({ workItemIds: ["11111111-1111-4111-8111-111111111111"] });
      expect(done).toMatchObject({ status: "recorded", fromEmployeeId: inA2.id, toEmployeeId: inA.id });
      expect(state.reassignments).toHaveLength(1);
    });

    it.each([
      ["the same person", { toEmployeeId: "SAME" }, 400, /someone other than/],
      ["bad work item ids", { workItemIds: ["x"] }, 400, /workItemIds must be/],
      ["too many work items", { workItemIds: Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`) }, 400, /1 to 100/],
      ["someone who was in", { fromEmployeeId: "IN" }, 409, /no absence to cover/],
      ["a future date", { date: "2026-10-05" }, 400, /future/],
    ])("refuses %s", async (_label, over, status, message) => {
      const body: any = { ...over };
      if (body.toEmployeeId === "SAME") body.toEmployeeId = inA2.id;
      if (body.fromEmployeeId === "IN") Object.assign(body, { fromEmployeeId: inA.id, toEmployeeId: inA2.id });
      await refused(reassign(body), status, message);
      expect(state.reassignments).toHaveLength(0);
    });

    it("refuses a cover who is not in, another store's cover, and answers 404 outside the scope", async () => {
      const third = await hire(w.hr, { storeId: w.storeA.id });
      await refused(reassign({ toEmployeeId: third.id }), 409, /not in that day/);
      await AttendanceService.clockIn(await ref(inB.id), {});
      await refused(reassign({ toEmployeeId: inB.id }), 400, /same store/);
      await refused(reassign({ toEmployeeId: inB.id }, asManagerA()), 404);
      await refused(reassign({ fromEmployeeId: "11111111-1111-4111-8111-111111111111" }), 404);
    });
  });
});

