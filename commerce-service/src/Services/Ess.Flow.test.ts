import { ServiceClient } from "../../commons/Http/ServiceClient.js";

// HR core runs for real over its in-memory fake; the HR people services are stand-ins that record how
// self-service calls them (their own rules are proved in their own tests).
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
jest.mock("../Queries/EssIdempotency.Query.js", () => ({ EssIdempotencyQuery: require("../Testing/InMemoryEss.js").idempotencyQuery }));
jest.mock("../Queries/EssIncident.Query.js", () => ({ EssIncidentQuery: require("../Testing/InMemoryEss.js").incidentQuery }));
jest.mock("./Grievance.Service.js", () => ({ GrievanceService: { raise: jest.fn(), getMine: jest.fn(), listMine: jest.fn() } }));
jest.mock("./HrRequest.Service.js", () => ({ HrRequestService: { send: jest.fn(), getMine: jest.fn(), listMine: jest.fn() } }));
jest.mock("./Training.Service.js", () => ({ TrainingService: { listMine: jest.fn(), startMine: jest.fn(), completeMine: jest.fn() } }));
jest.mock("./Pay.Service.js", () => ({ PayService: { getMyCompensation: jest.fn(), getMyEarnings: jest.fn(), listMyPayouts: jest.fn() } }));
jest.mock("./Performance.Service.js", () => ({ PerformanceService: { getMine: jest.fn(), listMine: jest.fn() } }));

import { reset as resetHr, state } from "../Testing/InMemoryHr.js";
import { ess, resetEss } from "../Testing/InMemoryEss.js";
import { FIXED_NOW, TODAY, World, actor, buildWorld, hire, refused, resetCounter, setNow } from "../Testing/HrTestKit.js";
import { resetFieldCipher } from "../Utils/FieldCipher.js";
import { EssService, NO_EMPLOYEE_RECORD } from "./Ess.Service.js";
import { EmployeeService } from "./Employee.Service.js";
import { GrievanceService } from "./Grievance.Service.js";
import { HrRequestService } from "./HrRequest.Service.js";
import { PayService } from "./Pay.Service.js";
import { PerformanceService } from "./Performance.Service.js";
import { TrainingService } from "./Training.Service.js";

const U_A = "11111111-1111-4111-8111-111111111111";
const U_B = "22222222-2222-4222-8222-222222222222";
const U_NONE = "33333333-3333-4333-8333-333333333333";
const KEY = "retry-key-0001";

let w: World;
let a: any;
let b: any;

const asA = (role: "staff" | "manager" = "staff") => actor(role, w.storeA.id, "Asha", U_A);
const leave = (over: Record<string, unknown> = {}) => ({ type: "casual", from: "2026-10-12", to: "2026-10-13", ...over });
const mocked = (fn: unknown) => fn as jest.Mock;
const leaveCount = () => state.requests.size;

beforeAll(() => {
  process.env.IS_LOCAL = "true";
  resetFieldCipher();
});

beforeEach(async () => {
  resetHr();
  resetEss();
  resetCounter();
  setNow(FIXED_NOW.toISOString());
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(ServiceClient, "get").mockResolvedValue({ id: "x", role: "staff", isActive: true });
  for (const fn of [GrievanceService.raise, GrievanceService.getMine, GrievanceService.listMine, HrRequestService.send, HrRequestService.getMine]) {
    mocked(fn).mockReset();
  }
  w = buildWorld();
  a = await hire(w.hr, { storeId: w.storeA.id, name: "Asha", gatewayUserId: U_A, payGrade: "G1", bankAccount: { holderName: "Asha K", accountNumber: "123456789012", ifsc: "HDFC0001234" } });
  b = await hire(w.hr, { storeId: w.storeA.id, name: "Bina", gatewayUserId: U_B });
  let n = 0;
  mocked(GrievanceService.raise).mockImplementation(async () => ({ id: `00000000-0000-4000-8000-00000000000${++n}` }));
  mocked(GrievanceService.getMine).mockImplementation(async (_me: any, id: string) => ({ id, replay: true }));
  mocked(HrRequestService.send).mockImplementation(async () => ({ id: `00000000-0000-4000-8000-00000000010${++n}` }));
  mocked(HrRequestService.getMine).mockImplementation(async (_me: any, id: string) => ({ id, replay: true }));
});

afterEach(() => jest.restoreAllMocks());

// ================================================================ who is calling
describe("resolving the caller", () => {
  it("answers 404 with a clear message when the login has no employee record, on every kind of call", async () => {
    const calls = [
      EssService.clockIn(U_NONE, {}),
      EssService.getMyEmploymentProfile(U_NONE),
      EssService.listMyLeaveRequests(U_NONE, {}),
      EssService.raiseMyGrievance(U_NONE, { category: "pay", description: "x" }, undefined),
      EssService.listMyIncidents(U_NONE, {}),
      EssService.getMyCompensation(U_NONE),
    ];
    for (const call of calls) await refused(call, 404, new RegExp(NO_EMPLOYEE_RECORD.slice(0, 20)));
  });

  it("hands the HR services only the caller's own employee, whatever the client sends", async () => {
    mocked(PayService.listMyPayouts).mockResolvedValue({ items: [] });
    mocked(PayService.getMyEarnings).mockResolvedValue({});
    mocked(TrainingService.completeMine).mockResolvedValue({});
    const evil = { employeeId: b.id, storeId: w.storeB.id, page: "1", limit: "5", from: "2026-09-01", to: "2026-09-30", month: "2026-09" };
    await EssService.listMyPayouts(U_A, evil);
    expect(mocked(PayService.listMyPayouts).mock.calls[0][0].id).toBe(a.id);
    expect(mocked(PayService.listMyPayouts).mock.calls[0][1]).toEqual({ page: "1", limit: "5", from: "2026-09-01", to: "2026-09-30" });
    await EssService.getMyEarnings(U_A, evil);
    expect(mocked(PayService.getMyEarnings).mock.calls[0][1]).toEqual({ month: "2026-09" });
    await EssService.completeMyTraining(U_A, "x", { score: 80, employeeId: b.id });
    expect(mocked(TrainingService.completeMine).mock.calls[0][0].id).toBe(a.id);
    expect(mocked(TrainingService.completeMine).mock.calls[0][2]).toEqual({ score: 80 });
  });
});

// ================================================================ attendance
describe("attendance", () => {
  it("clocks the caller in and out once a day, and a second clock-in or stray clock-out is a 409", async () => {
    const day = await EssService.clockIn(U_A, { latitude: 12.97, longitude: 77.59 });
    expect(day).toMatchObject({ date: TODAY, status: "present", clockOut: null });
    await refused(EssService.clockIn(U_A, {}), 409, /Already clocked in/);
    expect(await EssService.clockOut(U_A, {})).toMatchObject({ date: TODAY });
    await refused(EssService.clockOut(U_A, {}), 409, /Not clocked in/);
    await refused(EssService.clockIn(U_A, {}), 409, /Already clocked in/);
    await refused(EssService.clockOut(U_B, {}), 409, /Not clocked in/);
  });

  it("two simultaneous clock-ins create one record", async () => {
    const results = await Promise.allSettled([EssService.clockIn(U_A, {}), EssService.clockIn(U_A, {}), EssService.clockIn(U_A, {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([...state.attendance.values()].filter((r: any) => r.employeeId === a.id)).toHaveLength(1);
  });

  it("refuses a malformed position and a clock-in at another store", async () => {
    await refused(EssService.clockIn(U_A, { latitude: 120 }), 400, /latitude/);
    await refused(EssService.clockOut(U_A, { longitude: "x" }), 400, /longitude/);
    await refused(EssService.clockIn(U_A, { storeId: w.storeB.id }), 400, /own store/);
  });

  it("shows only the caller's own month, even when another person clocked in", async () => {
    await EssService.clockIn(U_B, {});
    await EssService.clockIn(U_A, {});
    const month: any = await EssService.getMyAttendance(U_A, { month: "2026-10", employeeId: b.id });
    expect(month.employeeId).toBe(a.id);
    expect(month.days.filter((d: any) => d.clockIn)).toHaveLength(1);
    await refused(EssService.getMyAttendance(U_A, { month: "2026-13" }), 400);
  });
});

// ================================================================ leave
describe("leave", () => {
  it("creates a pending request for the caller and lists only their own, ignoring an employeeId in the query", async () => {
    const { replayed, result }: any = await EssService.requestLeave(U_A, leave(), undefined);
    expect(replayed).toBe(false);
    expect(result).toMatchObject({ employeeId: a.id, status: "pending", from: "2026-10-12" });
    await EssService.requestLeave(U_B, leave({ type: "sick" }), undefined);
    const mine: any = await EssService.listMyLeaveRequests(U_A, { employeeId: b.id, status: "pending" });
    expect(mine.total).toBe(1);
    expect(mine.items[0].employeeId).toBe(a.id);
    const none: any = await EssService.listMyLeaveRequests(U_A, { status: "approved" });
    expect(none.total).toBe(0);
  });

  it("validates the request", async () => {
    await refused(EssService.requestLeave(U_A, leave({ type: "holiday" }), undefined), 400, /type/);
    await refused(EssService.requestLeave(U_A, leave({ from: "2026-10-14", to: "2026-10-12" }), undefined), 400);
    await refused(EssService.requestLeave(U_A, { type: "casual" }, undefined), 400);
  });

  it("an overlapping request is a 409; with an Idempotency-Key the retry returns the original instead", async () => {
    const first: any = await EssService.requestLeave(U_A, leave(), KEY);
    await refused(EssService.requestLeave(U_A, leave(), undefined), 409, /already have leave/);
    const retry: any = await EssService.requestLeave(U_A, leave(), KEY);
    expect(retry.replayed).toBe(true);
    expect(retry.result.id).toBe(first.result.id);
    expect(leaveCount()).toBe(1);
  });

  it("the same key used by two different people is two independent requests", async () => {
    const x: any = await EssService.requestLeave(U_A, leave(), KEY);
    const y: any = await EssService.requestLeave(U_B, leave(), KEY);
    expect(x.result.id).not.toBe(y.result.id);
    expect(leaveCount()).toBe(2);
  });

  it("racing retries with one key create exactly one request", async () => {
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => EssService.requestLeave(U_A, leave(), KEY)));
    expect(leaveCount()).toBe(1);
    const ok: any[] = results.filter((r) => r.status === "fulfilled").map((r: any) => r.value);
    expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as any).errorCode).toBe(409);
  });

  it("a failed first attempt frees the key, and a malformed key is a 400", async () => {
    await refused(EssService.requestLeave(U_A, leave({ type: "nope" }), KEY), 400);
    expect(ess.claims.size).toBe(0);
    const ok: any = await EssService.requestLeave(U_A, leave(), KEY);
    expect(ok.replayed).toBe(false);
    await refused(EssService.requestLeave(U_A, leave({ from: "2026-12-01", to: "2026-12-01" }), "short"), 400, /Idempotency-Key/);
  });

  it("a claim that never finished (older than two minutes) does not block the key forever", async () => {
    ess.claims.set(`${a.id}|leave_request|${KEY}`, { id: "c1", employeeId: a.id, operation: "leave_request", key: KEY, resourceId: null, createdAt: new Date(Date.now() - 10 * 60 * 1000) });
    const ok: any = await EssService.requestLeave(U_A, leave(), KEY);
    expect(ok.replayed).toBe(false);
    ess.claims.set(`${b.id}|leave_request|${KEY}`, { id: "c2", employeeId: b.id, operation: "leave_request", key: KEY, resourceId: null, createdAt: new Date() });
    await refused(EssService.requestLeave(U_B, leave(), KEY), 409, /still being processed/);
  });

  it("withdraws only the caller's own pending request; another person's is a 404", async () => {
    const mine: any = await EssService.requestLeave(U_A, leave(), undefined);
    const theirs: any = await EssService.requestLeave(U_B, leave({ type: "sick" }), undefined);
    await refused(EssService.withdrawMyLeaveRequest(U_A, theirs.result.id), 404);
    await refused(EssService.withdrawMyLeaveRequest(U_A, "not-a-uuid"), 404);
    expect(await EssService.withdrawMyLeaveRequest(U_A, mine.result.id)).toMatchObject({ status: "withdrawn" });
    await refused(EssService.withdrawMyLeaveRequest(U_A, mine.result.id), 409);
    const stillPending: any = await EssService.listMyLeaveRequests(U_B, { status: "pending" });
    expect(stillPending.total).toBe(1);
  });

  it("shows the caller's balances", async () => {
    const res: any = await EssService.getMyLeaveBalance(U_A);
    expect(res.balances.map((x: any) => x.type).sort()).toEqual(expect.arrayContaining(["casual", "sick", "earned"]));
    expect(res.balances[0]).toHaveProperty("remaining");
  });
});

// ================================================================ profile and career
describe("profile", () => {
  it("shows own details with the bank account masked and no pay grade", async () => {
    const p: any = await EssService.getMyEmploymentProfile(U_A);
    expect(p).toMatchObject({ id: a.id, name: "Asha", role: "Washer", storeId: w.storeA.id });
    expect(p.bankAccount.accountNumber).toBe("••••••9012");
    expect(JSON.stringify(p)).not.toContain("123456789012");
    expect(p).not.toHaveProperty("payGrade");
    expect(p).not.toHaveProperty("exitReason");
    expect(p).not.toHaveProperty("gatewayUserId");
  });

  it("updates contact details only, and the answer stays masked even for an hr or admin caller", async () => {
    const hrUser = actor("hr", null, "Asha", U_A);
    const p: any = await EssService.updateMyEmploymentProfile(hrUser, {
      phone: "+919800000099",
      email: "asha@example.com",
      address: "12 MG Road",
      emergencyContact: { name: "Ravi", phone: "+919800000088", relation: "Brother" },
    });
    expect(p).toMatchObject({ phone: "+919800000099", email: "asha@example.com", address: "12 MG Road", emergencyContact: { name: "Ravi" } });
    expect(p.bankAccount.accountNumber).toBe("••••••9012");
  });

  it("refuses to change anything HR owns, and an empty update, and a number someone else uses", async () => {
    for (const field of ["role", "storeId", "status", "payGrade", "bankAccount", "gatewayUserId", "employeeType", "name", "joinDate"]) {
      await refused(EssService.updateMyEmploymentProfile(asA(), { [field]: "x" }), 400, /cannot be changed here/);
    }
    await refused(EssService.updateMyEmploymentProfile(asA(), {}), 400, /Nothing to update/);
    await refused(EssService.updateMyEmploymentProfile(asA(), { phone: b.phone }), 409);
    await refused(EssService.updateMyEmploymentProfile(asA(), { phone: "12345" }), 400);
    expect((await EssService.getMyEmploymentProfile(U_A) as any).role).toBe("Washer");
  });

  it("shows the career history without pay grade changes, reasons or who made them", async () => {
    await EmployeeService.update(a.id, null, w.hr, { payGrade: "G2", designation: "Senior Washer" });
    const plan: any = await EssService.getMyCareerPlan(U_A);
    const fields = plan.history.map((h: any) => h.field);
    expect(fields).toContain("designation");
    expect(fields).not.toContain("pay_grade");
    for (const h of plan.history) expect(Object.keys(h).sort()).toEqual(["effectiveDate", "field", "from", "to"]);
    expect(plan).toHaveProperty("goals");
  });
});

// ================================================================ pay and appraisals
describe("pay and appraisals", () => {
  it("pages the caller's appraisals and caps the page size", async () => {
    mocked(PerformanceService.listMine).mockResolvedValue({ items: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}` })) });
    const p1: any = await EssService.listMyAppraisals(U_A, { limit: "3" });
    expect(p1.items).toHaveLength(3);
    expect(p1).toMatchObject({ page: 1, limit: 3, total: 7 });
    const p3: any = await EssService.listMyAppraisals(U_A, { limit: "3", page: "3" });
    expect(p3.items).toHaveLength(1);
    const big: any = await EssService.listMyAppraisals(U_A, { limit: "1000" });
    expect(big.limit).toBe(100);
    expect(mocked(PerformanceService.listMine).mock.calls[0][0].id).toBe(a.id);
  });
});

// ================================================================ reports and training
describe("daily reports", () => {
  it("submits once per date and lists only the caller's own", async () => {
    const report: any = await EssService.submitMyDailyReport(U_A, { date: TODAY, summary: "Washed 40 loads", blockers: "Dryer 2 down" });
    expect(report).toMatchObject({ employeeId: a.id, date: TODAY });
    await refused(EssService.submitMyDailyReport(U_A, { date: TODAY, summary: "again" }), 409);
    await EssService.submitMyDailyReport(U_B, { date: TODAY, summary: "Folded" });
    const mine: any = await EssService.listMyDailyReports(U_A, { employeeId: b.id });
    expect(mine.total).toBe(1);
    expect(mine.items[0].summary).toBe("Washed 40 loads");
    await refused(EssService.submitMyDailyReport(U_A, { date: "2027-01-01", summary: "x" }), 400);
    await refused(EssService.submitMyDailyReport(U_A, { summary: "x" }), 400);
  });
});

// ================================================================ support and safety
describe("grievances and HR requests", () => {
  it("raises a grievance as the caller, passing on only category, description and anonymous", async () => {
    const res: any = await EssService.raiseMyGrievance(U_A, { category: "pay", description: "Short pay", anonymous: true, againstEmployeeId: b.id, confidential: false, employeeId: b.id, status: "closed" }, undefined);
    expect(res.replayed).toBe(false);
    const [me, body] = mocked(GrievanceService.raise).mock.calls[0];
    expect(me.id).toBe(a.id);
    expect(body).toEqual({ category: "pay", description: "Short pay", anonymous: true });
  });

  it("a retry with the same key returns the first grievance and raises nothing new; a failed first attempt frees the key", async () => {
    const first: any = await EssService.raiseMyGrievance(U_A, { category: "pay", description: "x" }, KEY);
    const again: any = await EssService.raiseMyGrievance(U_A, { category: "pay", description: "x" }, KEY);
    expect(again).toMatchObject({ replayed: true, result: { id: first.result.id } });
    expect(GrievanceService.raise).toHaveBeenCalledTimes(1);
    mocked(GrievanceService.raise).mockRejectedValueOnce(new Error("boom"));
    await expect(EssService.raiseMyGrievance(U_A, { category: "pay", description: "x" }, "another-key-1")).rejects.toMatchObject({ errorCode: 500 });
    const ok: any = await EssService.raiseMyGrievance(U_A, { category: "pay", description: "x" }, "another-key-1");
    expect(ok.replayed).toBe(false);
  });

  it("sends an HR request as the caller, idempotently, and reads only through the caller's own record", async () => {
    const first: any = await EssService.sendMyHrRequest(U_B, { category: "payroll", message: "Payslip?", employeeId: a.id }, KEY);
    const again: any = await EssService.sendMyHrRequest(U_B, { category: "payroll", message: "Payslip?" }, KEY);
    expect(again.replayed).toBe(true);
    expect(again.result.id).toBe(first.result.id);
    expect(HrRequestService.send).toHaveBeenCalledTimes(1);
    expect(mocked(HrRequestService.send).mock.calls[0][0].id).toBe(b.id);
    expect(mocked(HrRequestService.send).mock.calls[0][1]).toEqual({ category: "payroll", message: "Payslip?" });
    await EssService.getMyHrRequest(U_B, "r1");
    await EssService.getMyGrievance(U_B, "g1");
    expect(mocked(HrRequestService.getMine).mock.calls.at(-1)![0].id).toBe(b.id);
    expect(mocked(GrievanceService.getMine).mock.calls.at(-1)![0].id).toBe(b.id);
  });
});

describe("my incidents", () => {
  const incident = (reportedBy: string, n: number) => ({
    id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`,
    reportedBy,
    type: "near_miss",
    severity: "low",
    status: "open",
    occurredAt: new Date(Date.UTC(2026, 8, n)),
    location: "Wash floor",
    createdAt: new Date(Date.UTC(2026, 8, n)),
  });

  it("lists only what the caller reported, newest first, paged and bounded", async () => {
    for (let n = 1; n <= 5; n += 1) ess.incidents.push(incident(U_A, n));
    ess.incidents.push(incident(U_B, 9));
    const p1: any = await EssService.listMyIncidents(U_A, { limit: "2" });
    expect(p1).toMatchObject({ page: 1, limit: 2, total: 5 });
    expect(p1.items.map((i: any) => i.occurredAt.slice(0, 10))).toEqual(["2026-09-05", "2026-09-04"]);
    expect(JSON.stringify(p1)).not.toContain("reportedBy");
    const p3: any = await EssService.listMyIncidents(U_A, { limit: "2", page: "3" });
    expect(p3.items).toHaveLength(1);
    expect(((await EssService.listMyIncidents(U_A, { limit: "5000" })) as any).limit).toBe(100);
    expect(((await EssService.listMyIncidents(U_B, {})) as any).total).toBe(1);
  });
});
