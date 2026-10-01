import { CustomException } from "../../commons/Exception/CustomException.js";
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
jest.mock("../Queries/Holiday.Query.js", () => ({ HolidayQuery: require("../Testing/InMemoryHr.js").holidayQuery }));
jest.mock("../Queries/Leave.Query.js", () => ({ LeaveQuery: require("../Testing/InMemoryHr.js").leaveQuery }));
// The people modules (P06) feed two summary counters; the summary tests here need them to read 0.
jest.mock("./PeopleSummary.js", () => ({ countOverdueTraining: async () => 0, countOpenGrievances: async () => 0 }));

import { employeeQuery, reset, state } from "../Testing/InMemoryHr.js";
import { FIXED_NOW, TODAY, World, buildWorld, hire, refused, rejection, resetCounter, scopeOf, setNow } from "../Testing/HrTestKit.js";
import { EmployeeAccess } from "./EmployeeAccess.js";
import { EmployeeDocumentService } from "./EmployeeDocument.Service.js";
import { EmployeeService, canMoveStatus } from "./Employee.Service.js";
import { HrSummaryService } from "./HrSummary.Service.js";
import { OnboardingService } from "./Onboarding.Service.js";
import { resetFieldCipher } from "../Utils/FieldCipher.js";

const USER_ID = "7d2f8d58-5c36-4d3c-9d1a-0a3b8a6a1111";
const OTHER_USER_ID = "7d2f8d58-5c36-4d3c-9d1a-0a3b8a6a2222";

let w: World;
let getSpy: jest.SpyInstance;
let postSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

const gatewayUser = (over: Record<string, unknown> = {}) => ({
  id: USER_ID,
  name: "Login",
  email: "a@b.in",
  phoneNumber: null,
  role: "staff",
  storeId: null,
  isActive: true,
  ...over,
});

beforeAll(() => {
  process.env.IS_LOCAL = "true";
  resetFieldCipher();
});

beforeEach(() => {
  reset();
  resetCounter();
  setNow(FIXED_NOW.toISOString());
  w = buildWorld();
  getSpy = jest.spyOn(ServiceClient, "get").mockResolvedValue(gatewayUser());
  postSpy = jest.spyOn(ServiceClient, "post").mockResolvedValue({});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating an employee", () => {
  it("numbers codes in sequence, copies the default onboarding checklist and records the starting history", async () => {
    const first = await hire(w.hr, { storeId: w.storeA.id, designation: "Senior washer", payGrade: "G2" });
    const second = await hire(w.hr, { storeId: w.storeA.id });
    expect(first.code).toBe("EMP-00001");
    expect(second.code).toBe("EMP-00002");

    const onboarding = await OnboardingService.getForEmployee(first.id, null);
    expect(onboarding.items.map((i) => i.title)).toEqual(["Photo ID collected", "Address proof collected", "Uniform issued"]);
    expect(onboarding.completionPct).toBe(0);

    const history = state.history.filter((h) => h.employeeId === first.id).map((h) => h.field).sort();
    expect(history).toEqual(["designation", "employee_type", "pay_grade", "role", "store"]);
  });

  it("uses the checklist of the person's own job role when one is defined", async () => {
    await OnboardingService.setTemplate("Rider", { items: [{ title: "Helmet issued", category: "equipment" }] });
    const rider = await hire(w.hr, { employeeType: "rider", role: " rider " });
    const items = (await OnboardingService.getForEmployee(rider.id, null)).items;
    expect(items.map((i) => i.title)).toEqual(["Helmet issued"]);
  });

  it("numbers concurrent creations without a duplicate code", async () => {
    const hired = await Promise.all(Array.from({ length: 10 }, () => hire(w.hr, { storeId: w.storeA.id })));
    expect(new Set(hired.map((h) => h.code)).size).toBe(10);
  });

  it.each([
    ["a missing name", { name: undefined }, /name is required/],
    ["a malformed phone", { phone: "12345" }, /phone must be/],
    ["an unknown employee type", { employeeType: "ceo" }, /employeeType must be one of/],
    ["staff with no store", { storeId: undefined }, /storeId is required/],
    ["a manager with no store", { employeeType: "manager", storeId: undefined }, /storeId is required/],
    ["a start as exited", { status: "exited" }, /cannot start as exited/],
    ["a store that does not exist", { storeId: "11111111-1111-4111-8111-111111111111" }, /store does not exist/],
    ["a malformed store id", { storeId: "nope" }, /storeId must be a valid id/],
    ["a joiner who is too young", { dateOfBirth: "2020-01-01" }, /dateOfBirth must make/],
    ["a join date far in the future", { joinDate: "2027-06-01" }, /joinDate must be a recent date/],
    ["an impossible date", { joinDate: "2026-02-30" }, /joinDate must be a date/],
    ["a bad e-mail", { email: "not-an-email" }, /email is not valid/],
    ["a bad IFSC", { bankAccount: { holderName: "A", accountNumber: "123456789", ifsc: "BAD" } }, /ifsc is not a valid/],
    ["a short account number", { bankAccount: { holderName: "A", accountNumber: "123", ifsc: "HDFC0001234" } }, /accountNumber must be/],
    ["an emergency contact without a phone", { emergencyContact: { name: "Mum" } }, /emergencyContact.phone must be/],
    ["an over-long name", { name: "x".repeat(81) }, /at most 80/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(hire(w.hr, { storeId: w.storeA.id, ...over }), 400, message);
    expect(state.employees.size).toBe(0);
  });

  it("refuses a store that is closed", async () => {
    const closed = (await import("../Testing/InMemoryHr.js")).seed.store({ code: "OLD", status: "closed" });
    await refused(hire(w.hr, { storeId: closed.id }), 400, /store is closed/);
  });

  it("lets a rider be created with no store", async () => {
    const rider = await hire(w.hr, { employeeType: "rider", role: "Rider" });
    expect(rider.storeId).toBeNull();
  });

  it("refuses a second employee with the same phone, whichever way it is written", async () => {
    await hire(w.hr, { storeId: w.storeA.id, phone: "9845012345" });
    await refused(hire(w.hr, { storeId: w.storeA.id, phone: "+91 98450 12345" }), 409, /phone number already exists/);
  });

  it("keeps date of birth and address from a manager", async () => {
    const view = await hire(w.hr, { storeId: w.storeA.id, dateOfBirth: "1995-04-05", address: "12 MG Road" });
    expect(view.dateOfBirth).toBe("1995-04-05");
    const asManager = await EmployeeService.getById(view.id, scopeOf(w.managerA), w.managerA);
    expect(asManager).not.toHaveProperty("dateOfBirth");
    expect(asManager).not.toHaveProperty("address");
  });
});

describe("linking a login account", () => {
  it("verifies the user with the gateway before linking", async () => {
    const view = await hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID });
    expect(view.gatewayUserId).toBe(USER_ID);
    expect(getSpy).toHaveBeenCalledWith("gateway", `/internal/users/${USER_ID}`);
  });

  it("answers 400 when the gateway has no such user", async () => {
    getSpy.mockRejectedValue(new CustomException("Not found", 404));
    await refused(hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID }), 400, /No login account exists/);
    expect(state.employees.size).toBe(0);
  });

  it.each([
    ["a customer account", { role: "customer" }, /customer account cannot be linked/],
    ["a deactivated account", { isActive: false }, /deactivated/],
  ])("refuses %s", async (_label, over, message) => {
    getSpy.mockResolvedValue(gatewayUser(over));
    await refused(hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID }), 400, message);
  });

  it("passes an outage through as 503 and creates nothing", async () => {
    getSpy.mockRejectedValue(new CustomException("A connected service is unavailable right now.", 503));
    await refused(hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID }), 503);
    expect(state.employees.size).toBe(0);
    expect(state.counter.value).toBe(0);
  });

  it("allows one employee per login", async () => {
    await hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID });
    await refused(hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID }), 409, /already linked/);
  });

  it("finds the employee by login through EmployeeAccess, and nothing for an unknown login", async () => {
    const view = await hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID });
    expect((await EmployeeAccess.findEmployeeByUserId(USER_ID))?.id).toBe(view.id);
    expect(await EmployeeAccess.findEmployeeByUserId(OTHER_USER_ID)).toBeNull();
    expect(await EmployeeAccess.findEmployeeByUserId("not-a-uuid")).toBeNull();
  });
});

describe("sensitive fields", () => {
  const bank = { holderName: "Ravi K", accountNumber: "123456789012", ifsc: "hdfc0001234" };

  it("encrypts the account number at rest and masks it for everyone but HR and admin", async () => {
    const created = await hire(w.hr, { storeId: w.storeA.id, bankAccount: bank, payGrade: "G3", dateOfBirth: "1990-01-01" });
    const stored = state.employees.get(created.id);
    expect(JSON.stringify(stored)).not.toContain("123456789012");
    expect(stored.bankAccountEnc).toMatch(/^v1:/);

    const asHr = await EmployeeService.getById(created.id, null, w.hr);
    expect(asHr.bankAccount).toEqual({ holderName: "Ravi K", accountNumber: "123456789012", ifsc: "HDFC0001234" });
    expect(asHr.payGrade).toBe("G3");

    const asAdmin = await EmployeeService.getById(created.id, null, w.admin);
    expect(asAdmin.bankAccount?.accountNumber).toBe("123456789012");

    const asManager = await EmployeeService.getById(created.id, scopeOf(w.managerA), w.managerA);
    expect(asManager.bankAccount?.accountNumber).toBe("••••••9012");
    expect(asManager.bankAccount?.ifsc).toBe("HDFC•••••••");
    expect(asManager).not.toHaveProperty("payGrade");
    expect(JSON.stringify(asManager)).not.toContain("123456789012");
  });

  it("never writes the account number to the log", async () => {
    await hire(w.hr, { storeId: w.storeA.id, bankAccount: bank });
    const logged = JSON.stringify([...errorSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain("123456789012");
  });

  it("shows a masked number when the stored value cannot be decrypted, instead of failing", async () => {
    const created = await hire(w.hr, { storeId: w.storeA.id, bankAccount: bank });
    state.employees.get(created.id).bankAccountEnc = "v1:AAAA:AAAA:AAAA";
    const view = await EmployeeService.getById(created.id, null, w.hr);
    expect(view.bankAccount?.accountNumber).toContain("9012");
    expect(view.bankAccount?.accountNumber).not.toContain("123456789012");
  });

  it("clears the bank account with null", async () => {
    const created = await hire(w.hr, { storeId: w.storeA.id, bankAccount: bank });
    const updated = await EmployeeService.update(created.id, null, w.hr, { bankAccount: null });
    expect(updated.bankAccount).toBeNull();
    expect(state.employees.get(created.id).bankAccountEnc).toBeNull();
  });
});

describe("store scope", () => {
  let inA: any;
  let inB: any;
  let rider: any;

  beforeEach(async () => {
    inA = await hire(w.hr, { storeId: w.storeA.id, name: "Asha" });
    inB = await hire(w.hr, { storeId: w.storeB.id, name: "Bala" });
    rider = await hire(w.hr, { employeeType: "rider", role: "Rider", name: "Chitra" });
  });

  it("gives HR and admin every store, and a store-bound admin only the chosen store", async () => {
    expect((await EmployeeService.list(scopeOf(w.hr), w.hr, {})).total).toBe(3);
    expect((await EmployeeService.list(scopeOf(w.admin), w.admin, {})).total).toBe(3);
    expect((await EmployeeService.list(scopeOf(w.admin, w.storeB.id), w.admin, {})).items.map((e) => e.name)).toEqual(["Bala"]);
  });

  it("shows a manager only their own store, never riders without one", async () => {
    const page = await EmployeeService.list(scopeOf(w.managerA), w.managerA, {});
    expect(page.items.map((e) => e.name)).toEqual(["Asha"]);
  });

  it("answers 404, not 403, for another store's employee or a store-less rider", async () => {
    await refused(EmployeeService.getById(inB.id, scopeOf(w.managerA), w.managerA), 404);
    await refused(EmployeeService.getById(rider.id, scopeOf(w.managerA), w.managerA), 404);
    await refused(EmployeeService.getById("not-a-uuid", null, w.hr), 404);
  });

  it("will not let a manager widen the list with ?storeId", async () => {
    await refused(EmployeeService.list(scopeOf(w.managerA), w.managerA, { storeId: w.storeB.id }), 404);
    expect((await EmployeeService.list(scopeOf(w.hr), w.hr, { storeId: w.storeB.id })).items).toHaveLength(1);
  });

  it("applies the same scope through EmployeeAccess", async () => {
    await refused(EmployeeAccess.assertEmployeeInScope(inB.id, w.storeA.id), 404);
    expect((await EmployeeAccess.assertEmployeeInScope(inA.id, w.storeA.id)).name).toBe("Asha");
    expect((await EmployeeAccess.assertEmployeeInScope(inB.id, null)).name).toBe("Bala");
    expect(await EmployeeAccess.listEmployeeIds(w.storeA.id)).toEqual([inA.id]);
    expect(await EmployeeAccess.listEmployeeIds(null, { types: ["rider"] })).toEqual([rider.id]);
  });

  it("bounds listEmployeeIds and pages through the rest", async () => {
    const all = await EmployeeAccess.listEmployeeIds(null, { limit: 2 });
    const rest = await EmployeeAccess.listEmployeeIds(null, { limit: 2, offset: 2 });
    expect(all).toHaveLength(2);
    expect([...all, ...rest].sort()).toEqual([inA.id, inB.id, rider.id].sort());
  });
});

describe("listing", () => {
  it("filters by type, status and a name or phone search", async () => {
    await hire(w.hr, { storeId: w.storeA.id, name: "Asha Rao", phone: "+919845011111" });
    const rider = await hire(w.hr, { employeeType: "rider", role: "Rider", name: "Bala Iyer", phone: "+919845022222" });
    await EmployeeService.update(rider.id, null, w.hr, { status: "notice" });
    expect((await EmployeeService.list(null, w.hr, { employeeType: "rider" })).items).toHaveLength(1);
    expect((await EmployeeService.list(null, w.hr, { status: "notice" })).items[0].name).toBe("Bala Iyer");
    expect((await EmployeeService.list(null, w.hr, { q: "asha" })).items).toHaveLength(1);
    expect((await EmployeeService.list(null, w.hr, { q: "22222" })).items[0].name).toBe("Bala Iyer");
  });

  it("pages, caps the page size at 100 and rejects a bad page", async () => {
    for (let i = 0; i < 5; i += 1) await hire(w.hr, { storeId: w.storeA.id });
    const first = await EmployeeService.list(null, w.hr, { limit: "2" });
    expect(first).toMatchObject({ page: 1, limit: 2, total: 5 });
    expect(first.items).toHaveLength(2);
    expect((await EmployeeService.list(null, w.hr, { limit: "500" })).limit).toBe(100);
    await refused(EmployeeService.list(null, w.hr, { page: "0" }), 400);
    await refused(EmployeeService.list(null, w.hr, { status: "retired" }), 400, /status must be one of/);
    await refused(EmployeeService.list(null, w.hr, { q: ["a", "b"] }), 400, /single value/);
  });
});

describe("editing an employee", () => {
  let emp: any;
  beforeEach(async () => {
    emp = await hire(w.hr, { storeId: w.storeA.id, designation: "Washer" });
  });

  it("changes only whitelisted fields and ignores everything else", async () => {
    const updated = await EmployeeService.update(emp.id, null, w.hr, {
      name: "New Name",
      code: "EMP-99999",
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2000-01-01",
      lastWorkingDay: "2026-01-01",
    });
    expect(updated.name).toBe("New Name");
    expect(updated.code).toBe(emp.code);
    expect(updated.id).toBe(emp.id);
    expect(updated.lastWorkingDay).toBeNull();
  });

  it("writes one history row per changed designation, store and pay grade, with the old and new values", async () => {
    const before = state.history.length;
    await EmployeeService.update(emp.id, null, w.hr, { designation: "Supervisor", storeId: w.storeB.id, payGrade: "G4" });
    const rows = state.history.slice(before);
    expect(rows).toHaveLength(3);
    const byField = Object.fromEntries(rows.map((r) => [r.field, [r.fromValue, r.toValue]]));
    expect(byField.designation).toEqual(["Washer", "Supervisor"]);
    expect(byField.store).toEqual([w.storeA.id, w.storeB.id]);
    expect(byField.pay_grade).toEqual([null, "G4"]);
  });

  it("writes no history for a change that changes nothing", async () => {
    const before = state.history.length;
    await EmployeeService.update(emp.id, null, w.hr, { designation: "Washer", name: "Same" });
    expect(state.history.length).toBe(before);
  });

  it("rolls the employee back when the history cannot be written", async () => {
    jest.spyOn(employeeQuery, "appendHistory").mockRejectedValueOnce(new Error("disk full"));
    await refused(EmployeeService.update(emp.id, null, w.hr, { designation: "Boss" }), 500);
    expect(state.employees.get(emp.id).designation).toBe("Washer");
  });

  it("serialises two concurrent edits so each history row starts from the previous value", async () => {
    const before = state.history.length;
    await Promise.all([
      EmployeeService.update(emp.id, null, w.hr, { designation: "Lead" }),
      EmployeeService.update(emp.id, null, w.hr, { designation: "Manager" }),
    ]);
    const chain = state.history.slice(before).filter((h) => h.field === "designation");
    expect(chain).toHaveLength(2);
    // The second edit started from what the first one wrote, not from the original value.
    expect(chain[0].fromValue).toBe("Washer");
    expect(chain[1].fromValue).toBe(chain[0].toValue);
    expect(state.employees.get(emp.id).designation).toBe(chain[1].toValue);
  });

  it("requires a store for staff and manager, but not for a rider", async () => {
    await refused(EmployeeService.update(emp.id, null, w.hr, { storeId: null }), 400, /storeId is required/);
    await refused(EmployeeService.update(emp.id, null, w.hr, { employeeType: "manager", storeId: "" }), 400, /storeId is required/);
    const rider = await EmployeeService.update(emp.id, null, w.hr, { employeeType: "rider", storeId: null });
    expect(rider.storeId).toBeNull();
  });

  it("refuses a store that does not exist and a phone that is taken", async () => {
    await refused(EmployeeService.update(emp.id, null, w.hr, { storeId: "11111111-1111-4111-8111-111111111111" }), 400, /store does not exist/);
    const other = await hire(w.hr, { storeId: w.storeA.id });
    await refused(EmployeeService.update(emp.id, null, w.hr, { phone: other.phone }), 409, /phone number/);
  });

  it("refuses reporting to oneself, in a loop, or to someone who left", async () => {
    const boss = await hire(w.hr, { storeId: w.storeA.id });
    await refused(EmployeeService.update(emp.id, null, w.hr, { reportingTo: emp.id }), 400, /report to themself/);
    await EmployeeService.update(emp.id, null, w.hr, { reportingTo: boss.id });
    await refused(EmployeeService.update(boss.id, null, w.hr, { reportingTo: emp.id }), 400, /report to themself/);
    await refused(EmployeeService.update(emp.id, null, w.hr, { reportingTo: "11111111-1111-4111-8111-111111111111" }), 400, /not an employee/);
  });

  it("answers 404 for an employee outside the caller's store", async () => {
    await refused(EmployeeService.update(emp.id, w.storeB.id, w.admin, { name: "X" }), 404);
    await refused(EmployeeService.update("nope", null, w.hr, { name: "X" }), 404);
  });

  describe("status transitions", () => {
    it.each([
      ["active", "on_leave", true],
      ["active", "notice", true],
      ["on_leave", "active", true],
      ["notice", "active", true],
      ["notice", "on_leave", true],
      ["active", "active", true],
      ["active", "exited", false],
      ["notice", "exited", false],
      ["exited", "active", false],
    ] as const)("%s to %s is allowed by edit: %s", (from, to, allowed) => {
      expect(canMoveStatus(from, to)).toBe(allowed);
    });

    it("moves between the editable statuses and records each move", async () => {
      await EmployeeService.update(emp.id, null, w.hr, { status: "notice" });
      await EmployeeService.update(emp.id, null, w.hr, { status: "active" });
      const moves = state.history.filter((h) => h.field === "status").map((h) => `${h.fromValue}>${h.toValue}`);
      expect(moves).toEqual(["active>notice", "notice>active"]);
    });

    it("refuses setting exited through an edit", async () => {
      await refused(EmployeeService.update(emp.id, null, w.hr, { status: "exited" }), 400, /deactivate action/);
    });
  });
});

describe("leaving and coming back", () => {
  let emp: any;
  beforeEach(async () => {
    emp = await hire(w.hr, { storeId: w.storeA.id, gatewayUserId: USER_ID });
  });

  it("records the exit, keeps the record, disables the login and audits it", async () => {
    const left = await EmployeeService.deactivate(emp.id, null, w.hr, { lastWorkingDay: "2026-09-30", reason: "Relocated" });
    expect(left).toMatchObject({ status: "exited", lastWorkingDay: "2026-09-30", exitReason: "Relocated", loginDisabled: true });
    expect(postSpy).toHaveBeenCalledWith("gateway", `/internal/users/${USER_ID}/deactivate`, expect.anything());
    expect(state.employees.has(emp.id)).toBe(true);
    const row = state.history.find((h) => h.toValue === "exited");
    expect(row).toMatchObject({ fromValue: "active", reason: "Relocated" });
  });

  it("still records the exit when the gateway cannot disable the login, and says so", async () => {
    postSpy.mockRejectedValue(new CustomException("Not found", 404));
    const left = await EmployeeService.deactivate(emp.id, null, w.hr, { lastWorkingDay: TODAY });
    expect(left.status).toBe("exited");
    expect(left.loginDisabled).toBe(false);
  });

  it.each([
    ["no last working day", {}, /lastWorkingDay must be a date/],
    ["a future last working day", { lastWorkingDay: "2026-10-15" }, /in the future/],
    ["a last day before joining", { lastWorkingDay: "2025-12-31" }, /before the join date/],
    ["an over-long reason", { lastWorkingDay: TODAY, reason: "x".repeat(301) }, /at most 300/],
  ])("refuses %s", async (_label, body, message) => {
    await refused(EmployeeService.deactivate(emp.id, null, w.hr, body), 400, message);
    expect(state.employees.get(emp.id).status).toBe("active");
  });

  it("refuses to record the same exit twice and freezes edits until reactivation", async () => {
    await EmployeeService.deactivate(emp.id, null, w.hr, { lastWorkingDay: TODAY });
    await refused(EmployeeService.deactivate(emp.id, null, w.hr, { lastWorkingDay: TODAY }), 409, /already left/);
    await refused(EmployeeService.update(emp.id, null, w.hr, { name: "X" }), 400, /Reactivate/);
  });

  it("answers 404 for someone outside the caller's store", async () => {
    await refused(EmployeeService.deactivate(emp.id, w.storeB.id, w.admin, { lastWorkingDay: TODAY }), 404);
  });

  it("brings a former employee back, clears the exit and re-enables the login", async () => {
    await EmployeeService.deactivate(emp.id, null, w.hr, { lastWorkingDay: "2026-09-30", reason: "Left" });
    const back = await EmployeeService.reactivate(emp.id, null, w.hr);
    expect(back).toMatchObject({ status: "active", lastWorkingDay: null, loginEnabled: true });
    expect(postSpy).toHaveBeenLastCalledWith("gateway", `/internal/users/${USER_ID}/reactivate`, expect.anything());
    expect(state.employees.get(emp.id).exitReason).toBeNull();
  });

  it("refuses to reactivate someone who has not left", async () => {
    await refused(EmployeeService.reactivate(emp.id, null, w.hr), 409, /has not left/);
  });
});

describe("documents", () => {
  let emp: any;
  beforeEach(async () => {
    emp = await hire(w.hr, { storeId: w.storeA.id });
  });

  it("stores a reference, lists it newest first and removes it", async () => {
    const doc = await EmployeeDocumentService.add(emp.id, null, w.hr, {
      type: "id_proof",
      fileName: "aadhaar.pdf",
      fileUrl: "https://files.example.com/a.pdf",
      sizeBytes: 1200,
    });
    expect(doc).toMatchObject({ type: "id_proof", fileName: "aadhaar.pdf", downloadUrl: "https://files.example.com/a.pdf" });
    expect((await EmployeeDocumentService.list(emp.id, null, {})).total).toBe(1);
    expect(await EmployeeDocumentService.remove(emp.id, doc.id, null)).toEqual({ id: doc.id, removed: true });
    expect((await EmployeeDocumentService.list(emp.id, null, {})).total).toBe(0);
  });

  it.each([
    ["an unknown type", { type: "selfie" }, /type must be one of/],
    ["a link that is not https", { fileUrl: "http://x.example.com/a.pdf" }, /https link/],
    ["a path in the file name", { fileName: "../a.pdf" }, /must not contain a path/],
    ["a missing file name", { fileName: undefined }, /fileName is required/],
    ["a file that is too big", { sizeBytes: 100_000_000 }, /sizeBytes must be/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(
      EmployeeDocumentService.add(emp.id, null, w.hr, { type: "other", fileName: "a.pdf", fileUrl: "https://x.example.com/a", ...over }),
      400,
      message
    );
  });

  it("answers 404 for another store's employee and for another employee's document", async () => {
    const other = await hire(w.hr, { storeId: w.storeA.id });
    const doc = await EmployeeDocumentService.add(other.id, null, w.hr, { type: "other", fileName: "a.pdf", fileUrl: "https://x.example.com/a" });
    await refused(EmployeeDocumentService.add(emp.id, w.storeB.id, w.admin, { type: "other", fileName: "a", fileUrl: "https://x.example.com/a" }), 404);
    await refused(EmployeeDocumentService.list(emp.id, w.storeB.id, {}), 404);
    await refused(EmployeeDocumentService.remove(emp.id, doc.id, null), 404);
  });
});

describe("onboarding", () => {
  let emp: any;
  beforeEach(async () => {
    emp = await hire(w.hr, { storeId: w.storeA.id });
  });

  it("ticks items off, stamps the time and reports the completion", async () => {
    const [first, second] = (await OnboardingService.getForEmployee(emp.id, null)).items;
    const done = await OnboardingService.updateItem(emp.id, first.id, null, w.hr, { status: "done", note: "Seen" });
    expect(done).toMatchObject({ status: "done", note: "Seen", doneAt: FIXED_NOW.toISOString() });
    await OnboardingService.updateItem(emp.id, second.id, null, w.hr, { status: "given" });
    const progress = await OnboardingService.getForEmployee(emp.id, null);
    expect(progress.completionPct).toBe(33.3);
    const reopened = await OnboardingService.updateItem(emp.id, first.id, null, w.hr, { status: "pending" });
    expect(reopened).not.toHaveProperty("doneAt");
  });

  it("refuses a bad status, an unknown item and another employee's item", async () => {
    const [item] = (await OnboardingService.getForEmployee(emp.id, null)).items;
    const other = await hire(w.hr, { storeId: w.storeA.id });
    await refused(OnboardingService.updateItem(emp.id, item.id, null, w.hr, { status: "finished" }), 400, /status must be one of/);
    await refused(OnboardingService.updateItem(emp.id, "nope", null, w.hr, { status: "done" }), 404);
    await refused(OnboardingService.updateItem(other.id, item.id, null, w.hr, { status: "done" }), 404);
    await refused(OnboardingService.updateItem(emp.id, item.id, w.storeB.id, w.admin, { status: "done" }), 404);
  });

  it("keeps a joiner's checklist when the template changes later", async () => {
    await OnboardingService.setTemplate("default", { items: [{ title: "Only this now" }] });
    expect((await OnboardingService.getForEmployee(emp.id, null)).items).toHaveLength(3);
    const newer = await hire(w.hr, { storeId: w.storeA.id });
    expect((await OnboardingService.getForEmployee(newer.id, null)).items.map((i) => i.title)).toEqual(["Only this now"]);
  });

  it("validates and normalises templates", async () => {
    await refused(OnboardingService.setTemplate("washer", { items: [] }), 400, /1 to 50/);
    await refused(OnboardingService.setTemplate("washer", { items: [{ title: "x", category: "party" }] }), 400, /category must be one of/);
    await refused(OnboardingService.setTemplate("washer", { items: [{ category: "access" }] }), 400, /title is required/);
    await refused(OnboardingService.setTemplate("   ", { items: [{ title: "x" }] }), 400, /role must be/);
    const saved = await OnboardingService.setTemplate("Senior  Washer!", { items: [{ title: "Badge", category: "access" }] });
    expect(saved.role).toBe("senior washer");
    expect(await OnboardingService.getTemplate("SENIOR WASHER")).toEqual({ role: "senior washer", items: [{ title: "Badge", category: "access" }] });
    expect((await OnboardingService.getTemplate("unknown")).items).toEqual([]);
  });
});

describe("the HR summary", () => {
  it("counts the scope and breaks it down, and leaves out the per-store split when limited to one store", async () => {
    const a = await hire(w.hr, { storeId: w.storeA.id });
    await hire(w.hr, { storeId: w.storeB.id });
    await hire(w.hr, { employeeType: "rider", role: "Rider" });
    const gone = await hire(w.hr, { storeId: w.storeA.id });
    await EmployeeService.deactivate(gone.id, null, w.hr, { lastWorkingDay: "2026-09-20" });
    await EmployeeService.update(a.id, null, w.hr, { status: "on_leave" });

    const all = await HrSummaryService.getSummary(scopeOf(w.hr), {});
    expect(all).toMatchObject({ headcount: 3, exitsLast90Days: 1, attritionRate90dPct: 25, openGrievances: 0, overdueTraining: 0 });
    expect(all.byType).toEqual({ staff: 2, rider: 1 });
    expect(all.byStatus).toMatchObject({ active: 2, on_leave: 1, exited: 1 });
    expect(all.byStore).toBeDefined();

    const own = await HrSummaryService.getSummary(scopeOf(w.managerA), {});
    expect(own.headcount).toBe(1);
    expect(own).not.toHaveProperty("byStore");
    await refused(HrSummaryService.getSummary(scopeOf(w.managerA), { storeId: w.storeB.id }), 404);
  });

  it("refuses to store a bank account when no encryption key is configured outside local mode", async () => {
    const previous = process.env.IS_LOCAL;
    process.env.IS_LOCAL = "false";
    delete process.env.HR_DATA_KEY;
    resetFieldCipher();
    try {
      const error = await rejection(
        hire(w.hr, { storeId: w.storeA.id, bankAccount: { holderName: "A", accountNumber: "123456789", ifsc: "HDFC0001234" } })
      );
      expect(error.errorCode).toBe(503);
      expect(state.employees.size).toBe(0);
    } finally {
      process.env.IS_LOCAL = previous;
      resetFieldCipher();
    }
  });
});

