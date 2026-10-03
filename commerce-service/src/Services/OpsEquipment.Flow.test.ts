import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";

// Only the Query modules (and the floor and the clock) are replaced; every service rule,
// the lifecycle and the due-date arithmetic below are the real code.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Store.Query.js", () => ({ StoreQuery: require("../Testing/InMemoryOpsAssets.js").storeQuery }));
jest.mock("../Queries/Equipment.Query.js", () => ({ EquipmentQuery: require("../Testing/InMemoryOpsAssets.js").equipmentQuery }));
jest.mock("../Queries/EquipmentRecords.Query.js", () => ({ EquipmentRecordsQuery: require("../Testing/InMemoryOpsAssets.js").equipmentRecordsQuery }));
jest.mock("../Queries/EquipmentMaintenance.Query.js", () => ({ EquipmentMaintenanceQuery: require("../Testing/InMemoryOpsAssets.js").equipmentMaintenanceQuery }));
jest.mock("./Machines.Service.js", () => ({ MachinesService: { registerMachine: jest.fn(), setMachineState: jest.fn() } }));

import { db, reset } from "../Testing/InMemoryOpsAssets.js";
import { addDays, businessToday, formatDate } from "../Utils/AssetDates.js";
import { amountToPaise, kgToGrams } from "../Utils/AssetInput.js";
import { MachinesService } from "./Machines.Service.js";
import { EquipmentMaintenanceService, planSchedule } from "./EquipmentMaintenance.Service.js";
import { EquipmentRecordsService, downtimeOf } from "./EquipmentRecords.Service.js";
import { OpsEquipmentService, recommend } from "./OpsEquipment.Service.js";

const machines = MachinesService as unknown as { registerMachine: jest.Mock; setMachineState: jest.Mock };
const day = (n: number) => formatDate(addDays(businessToday(), n));

const STORE_A = "11111111-1111-4111-8111-1111111111a1";
const STORE_B = "11111111-1111-4111-8111-1111111111b2";
const person = (role: UserRole, n: number, storeId: string | null = null): RequestUser => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  role,
  storeId,
  scopeStoreId: null,
  name: null,
});
const admin = person("admin", 1);
const hr = person("hr", 2);
const managerA = person("manager", 3, STORE_A);
const managerB = person("manager", 4, STORE_B);
const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) => resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  try {
    await promise;
  } catch (error) {
    expect((error as CustomException).errorCode).toBe(status);
    if (message) expect((error as CustomException).displayMessage).toMatch(message);
    return;
  }
  throw new Error("expected the call to be rejected");
};

const register = (user: RequestUser, body: Record<string, unknown> = {}) =>
  OpsEquipmentService.create(scopeOf(user), user, { name: "Washer 1", type: "washer", storeId: STORE_A, capacityKg: 12, ...body }) as Promise<any>;

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  db.stores.set(STORE_A, { id: STORE_A });
  db.stores.set(STORE_B, { id: STORE_B });
  machines.registerMachine.mockReset().mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000f1" });
  machines.setMachineState.mockReset().mockResolvedValue({});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe("registering equipment", () => {
  it("draws a company-unique asset tag, keeps money in paise and writes the first history row", async () => {
    const first = await register(admin, { purchaseCost: 45000.5, make: "Electrolux" });
    const second = await register(hr, { name: "Dryer 1", type: "dryer" });
    expect([first.assetTag, second.assetTag]).toEqual(["EQ-00001", "EQ-00002"]);
    expect(first.purchaseCost).toBe(45000.5);
    expect([...db.equipment.values()][0].purchaseCostPaise).toBe(4500050);
    const detail = await OpsEquipmentService.getById(first.id, null);
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ from: null, to: "active", reason: "Registered" });
  });

  it("registers a floor machine for a washer and keeps its id; a boiler is not a floor machine", async () => {
    const washer = await register(admin);
    expect(machines.registerMachine).toHaveBeenCalledWith(expect.objectContaining({ code: washer.assetTag, capacityKg: 12, storeId: STORE_A }));
    expect(washer.machineId).toBe("00000000-0000-4000-8000-0000000000f1");
    machines.registerMachine.mockClear();
    const boiler = await register(admin, { name: "Boiler", type: "boiler", capacityKg: undefined });
    expect(machines.registerMachine).not.toHaveBeenCalled();
    expect(boiler.machineId).toBeNull();
  });

  it("still registers when the floor is unreachable", async () => {
    machines.registerMachine.mockRejectedValue(new Error("floor down"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await register(admin)).machineId).toBeNull();
    warn.mockRestore();
  });

  it("refuses a duplicate typed tag with 409 and skips a generated tag that was already typed in by hand", async () => {
    await register(admin, { assetTag: "eq-00001" });
    await refused(register(admin, { assetTag: "EQ-00001" }), 409, /asset tag/);
    expect((await register(admin)).assetTag).toBe("EQ-00002");
  });

  it.each([
    [{ name: "" }, /name is required/],
    [{ type: "toaster" }, /type must be one of/],
    [{ storeId: "nope" }, /storeId must be a valid id/],
    [{ purchaseCost: 10.123 }, /purchaseCost/],
    [{ purchaseCost: -1 }, /purchaseCost/],
    [{ capacityKg: 0 }, /capacityKg/],
    [{ purchasedOn: "2026-02-31" }, /purchasedOn must be a date/],
    [{ purchasedOn: day(5) }, /future/],
    [{ status: "retired" }, /retire/],
    [{ assetTag: "x" }, /assetTag/],
  ])("refuses invalid input %j", async (bad, message) => {
    await refused(register(admin, bad as Record<string, unknown>), 400, message as RegExp);
  });

  it("answers 404 for a store that does not exist", async () => {
    await refused(register(admin, { storeId: "11111111-1111-4111-8111-1111111111ff" }), 404);
  });

  it("converts money and weight exactly", () => {
    expect(amountToPaise(0.1 + 0.2, "x")).toBe(30);
    expect(amountToPaise(0, "x")).toBe(0);
    expect(kgToGrams(12.5, "x")).toBe(12500);
  });
});

describe("store scope", () => {
  let inA: any;
  let inB: any;
  beforeEach(async () => {
    inA = await register(admin, { storeId: STORE_A });
    inB = await register(admin, { name: "Washer B", storeId: STORE_B });
  });

  it("a manager lists and reads only their own store; another store is 404 for them", async () => {
    const mine = (await OpsEquipmentService.list(scopeOf(managerA), {})) as any;
    expect(mine.items.map((i: any) => i.id)).toEqual([inA.id]);
    await refused(OpsEquipmentService.getById(inB.id, scopeOf(managerA)), 404);
    await refused(OpsEquipmentService.list(scopeOf(managerA), { storeId: STORE_B }), 404);
    await refused(EquipmentRecordsService.listRepairs(inB.id, scopeOf(managerA), {}), 404);
    await refused(EquipmentRecordsService.createRepair(inB.id, scopeOf(managerA), managerA, { reportedOn: day(0), issue: "x" }), 404);
    await refused(EquipmentMaintenanceService.getSchedule(inB.id, scopeOf(managerA)), 404);
  });

  it("admin and hr see every store; an admin who chose a store sees that one", async () => {
    expect(((await OpsEquipmentService.list(scopeOf(admin), {})) as any).total).toBe(2);
    expect(((await OpsEquipmentService.list(scopeOf(hr), {})) as any).total).toBe(2);
    expect(((await OpsEquipmentService.list(scopeOf(admin, STORE_B), {})) as any).items[0].id).toBe(inB.id);
    expect(((await OpsEquipmentService.list(scopeOf(hr), { storeId: STORE_B })) as any).total).toBe(1);
  });

  it("an admin acting inside one store cannot register or move a machine into another", async () => {
    await refused(OpsEquipmentService.create(scopeOf(admin, STORE_A), admin, { name: "x", type: "iron", storeId: STORE_B }), 404);
    await refused(OpsEquipmentService.update(inA.id, scopeOf(admin, STORE_A), admin, { storeId: STORE_B }), 404);
  });

  it("pages are bounded", async () => {
    expect(((await OpsEquipmentService.list(null, { limit: "1000" })) as any).limit).toBe(100);
    await refused(OpsEquipmentService.list(null, { page: "0" }), 400);
    expect(((await OpsEquipmentService.list(null, { limit: "1", page: "2" })) as any).items).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  it("moves freely between working states, writes a history row for each move, and retires for good", async () => {
    const item = await register(admin);
    await OpsEquipmentService.update(item.id, null, admin, { status: "out_of_service" });
    await OpsEquipmentService.update(item.id, null, admin, { status: "under_repair" });
    await OpsEquipmentService.update(item.id, null, admin, { status: "under_repair", name: "Renamed" });
    const retired = (await OpsEquipmentService.retire(item.id, null, admin, { reason: "Beyond repair" })) as any;
    expect(retired).toMatchObject({ status: "retired", retiredReason: "Beyond repair" });
    const history = ((await OpsEquipmentService.getById(item.id, null)) as any).history;
    expect(history.map((h: any) => `${h.from}>${h.to}`)).toEqual(["under_repair>retired", "out_of_service>under_repair", "active>out_of_service", "null>active"]);
  });

  it("refuses to change or retire a retired machine, and to set retired by PATCH", async () => {
    const item = await register(admin);
    await refused(OpsEquipmentService.update(item.id, null, admin, { status: "retired" }), 400, /retire action/);
    await OpsEquipmentService.retire(item.id, null, admin, { reason: "Sold" });
    await refused(OpsEquipmentService.update(item.id, null, admin, { name: "x" }), 409, /retired/);
    await refused(OpsEquipmentService.update(item.id, null, admin, { status: "active" }), 409);
    await refused(OpsEquipmentService.retire(item.id, null, admin, { reason: "again" }), 409);
    await refused(EquipmentRecordsService.recordInspection(item.id, null, admin, { date: day(0), result: "pass" }), 409);
    await refused(EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [] }), 409);
  });

  it("needs a reason, ignores fields it does not own, and clears optional fields with null", async () => {
    const item = await register(admin, { make: "Miele" });
    await refused(OpsEquipmentService.retire(item.id, null, admin, {}), 400, /reason/);
    await refused(OpsEquipmentService.update(item.id, null, admin, {}), 400, /Nothing to update/);
    await refused(OpsEquipmentService.update(item.id, null, admin, { assetTag: "EQ-99999", id: "x", createdAt: "x" }), 400, /Nothing to update/);
    const cleared = (await OpsEquipmentService.update(item.id, null, admin, { make: null })) as any;
    expect(cleared.make).toBeNull();
    expect(cleared.assetTag).toBe(item.assetTag);
  });

  it("retiring ends the maintenance schedule", async () => {
    const item = await register(admin);
    await EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "Oil", everyDays: 30 }] });
    await OpsEquipmentService.retire(item.id, null, admin, { reason: "Sold" });
    expect(db.tasks.size).toBe(0);
  });
});

describe("repairs and downtime", () => {
  it("a reported repair takes the machine out of service, and closing the last one brings it back", async () => {
    const item = await register(admin);
    const first = (await EquipmentRecordsService.createRepair(item.id, null, managerA, { reportedOn: day(-3), issue: "Drum bearing", cost: 1200, downtimeHours: 5 })) as any;
    expect(((await OpsEquipmentService.getById(item.id, null)) as any).status).toBe("under_repair");
    expect(machines.setMachineState).toHaveBeenLastCalledWith({ machineId: "00000000-0000-4000-8000-0000000000f1", state: "maintenance" });
    const second = (await EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(-1), issue: "Door seal" })) as any;

    await EquipmentRecordsService.updateRepair(item.id, first.id, null, admin, { resolvedOn: day(-1), cost: 1500 });
    expect(((await OpsEquipmentService.getById(item.id, null)) as any).status).toBe("under_repair");
    machines.setMachineState.mockClear();
    await EquipmentRecordsService.updateRepair(item.id, second.id, null, admin, { resolvedOn: day(0) });
    const detail = (await OpsEquipmentService.getById(item.id, null)) as any;
    expect(detail.status).toBe("active");
    expect(detail.history[0]).toMatchObject({ from: "under_repair", to: "active" });
    expect(machines.setMachineState).toHaveBeenCalledWith({ machineId: "00000000-0000-4000-8000-0000000000f1", state: "idle" });
    const list = (await EquipmentRecordsService.listRepairs(item.id, null, {})) as any;
    expect(list.items.find((r: any) => r.id === first.id)).toMatchObject({ cost: 1500, downtimeHours: 5 });
  });

  it("does not touch a machine that is already out of service, and validates dates and money", async () => {
    const item = await register(admin);
    await OpsEquipmentService.update(item.id, null, admin, { status: "out_of_service" });
    const repair = (await EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(-2), issue: "Motor" })) as any;
    expect(((await OpsEquipmentService.getById(item.id, null)) as any).status).toBe("out_of_service");
    await refused(EquipmentRecordsService.updateRepair(item.id, repair.id, null, admin, { resolvedOn: day(-5) }), 400, /before/);
    await refused(EquipmentRecordsService.updateRepair(item.id, repair.id, null, admin, { resolvedOn: day(3) }), 400, /future/);
    await refused(EquipmentRecordsService.updateRepair(item.id, repair.id, null, admin, { cost: -5 }), 400);
    await refused(EquipmentRecordsService.updateRepair(item.id, repair.id, null, admin, {}), 400, /Nothing/);
    await refused(EquipmentRecordsService.updateRepair(item.id, "11111111-1111-4111-8111-1111111111ff", null, admin, { cost: 1 }), 404);
    await refused(EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(0) }), 400, /issue/);
    await refused(EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(0), issue: "x", downtimeHours: -1 }), 400);
  });

  it("downtime counts recorded hours, else the days between dates, else the time so far", async () => {
    const item = await register(admin);
    const a = (await EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(-20), issue: "A", downtimeHours: 6 })) as any;
    await EquipmentRecordsService.updateRepair(item.id, a.id, null, admin, { resolvedOn: day(-19) });
    const b = (await EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(-10), issue: "B" })) as any;
    await EquipmentRecordsService.updateRepair(item.id, b.id, null, admin, { resolvedOn: day(-8) });
    await EquipmentRecordsService.createRepair(item.id, null, admin, { reportedOn: day(-1), issue: "C" });

    const result = (await EquipmentRecordsService.downtime(item.id, null, {})) as any;
    expect(result.incidents).toBe(3);
    expect(result.periods.map((p: any) => p.ongoing)).toEqual([false, false, true]);
    expect(result.totalHours).toBeGreaterThan(6 + 48);
    const narrow = (await EquipmentRecordsService.downtime(item.id, null, { from: day(-12), to: day(-5) })) as any;
    expect(narrow).toMatchObject({ incidents: 1, totalHours: 48 });
    await refused(EquipmentRecordsService.downtime(item.id, null, { from: day(0), to: day(-3) }), 400);
  });

  it("downtimeOf: a closed repair without hours spans its dates", () => {
    const repair: any = { reportedOn: addDays(businessToday(), -3), resolvedOn: addDays(businessToday(), -1), downtimeMinutes: null };
    expect(downtimeOf(repair, new Date()).minutes).toBe(2 * 24 * 60);
  });
});

describe("inspections", () => {
  it("records who inspected, validates the checklist, and lists newest first", async () => {
    const item = await register(admin);
    await EquipmentRecordsService.recordInspection(item.id, null, admin, { date: day(-7), result: "pass" });
    const recorded = (await EquipmentRecordsService.recordInspection(item.id, scopeOf(managerA), managerA, {
      date: day(0),
      result: "needs_attention",
      checklist: [{ item: "Belt", ok: false }, { item: "Door", ok: true }],
      notes: "Belt frayed",
    })) as any;
    expect(recorded).toMatchObject({ inspector: "Store manager", result: "needs_attention" });
    const list = (await EquipmentRecordsService.listInspections(item.id, null, {})) as any;
    expect(list.items.map((i: any) => i.date)).toEqual([day(0), day(-7)]);
    await refused(EquipmentRecordsService.recordInspection(item.id, null, admin, { date: day(0), result: "great" }), 400);
    await refused(EquipmentRecordsService.recordInspection(item.id, null, admin, { date: day(0), result: "pass", checklist: [{ item: "x", ok: "yes" }] }), 400, /ok/);
    await refused(EquipmentRecordsService.recordInspection(item.id, null, admin, { date: day(1), result: "pass" }), 400, /future/);
  });
});

describe("maintenance schedule", () => {
  it("computes due dates from the last service and keeps ids and dates when the same schedule is saved again", async () => {
    const item = await register(admin);
    const saved = (await EquipmentMaintenanceService.setSchedule(item.id, null, {
      tasks: [{ name: "Lubricate", everyDays: 30, lastDoneOn: day(-10) }, { name: "Descale", everyDays: 90 }],
    })) as any;
    const byName = Object.fromEntries(saved.tasks.map((t: any) => [t.name, t]));
    expect(byName.Lubricate.nextDueOn).toBe(day(20));
    expect(byName.Descale).toMatchObject({ lastDoneOn: null, nextDueOn: day(90) });

    db.tasks.get(byName.Descale.id).nextDueOn = addDays(businessToday(), 40); // time passes: due in 40 days
    const again = (await EquipmentMaintenanceService.setSchedule(item.id, null, {
      tasks: [{ name: "lubricate", everyDays: 30 }, { name: "DESCALE", everyDays: 90 }],
    })) as any;
    expect(again.tasks.map((t: any) => t.id).sort()).toEqual(saved.tasks.map((t: any) => t.id).sort());
    expect(again.tasks.find((t: any) => t.name === "Descale").nextDueOn).toBe(day(40));
  });

  it("changing the interval moves the due date, removed names go, duplicates and bad numbers are refused", async () => {
    const item = await register(admin);
    await EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "A", everyDays: 10, lastDoneOn: day(-4) }, { name: "B", everyDays: 5 }] });
    const next = (await EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "A", everyDays: 20 }] })) as any;
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].nextDueOn).toBe(day(16));
    await refused(EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "A", everyDays: 1 }, { name: "a", everyDays: 2 }] }), 400, /twice/);
    await refused(EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "A", everyDays: 0 }] }), 400);
    await refused(EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: "x" }), 400);
    await refused(EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: Array.from({ length: 51 }, (_, i) => ({ name: `t${i}`, everyDays: 1 })) }), 400);
    expect(planSchedule([], [], businessToday())).toEqual({ create: [], update: [], removeIds: [] });
  });

  it("lists what is due and what is overdue, soonest and longest first, within the caller's store", async () => {
    const a = await register(admin, { storeId: STORE_A });
    const b = await register(admin, { name: "Other", storeId: STORE_B });
    await EquipmentMaintenanceService.setSchedule(a.id, null, { tasks: [
      { name: "Late", everyDays: 10, lastDoneOn: day(-15) },
      { name: "Later", everyDays: 10, lastDoneOn: day(-12) },
      { name: "Soon", everyDays: 10, lastDoneOn: day(-5) },
      { name: "Far", everyDays: 100 },
    ] });
    await EquipmentMaintenanceService.setSchedule(b.id, null, { tasks: [{ name: "Elsewhere", everyDays: 10, lastDoneOn: day(-20) }] });

    const overdue = (await EquipmentMaintenanceService.listOverdue(scopeOf(managerA), {})) as any;
    expect(overdue.tasks.map((t: any) => [t.name, t.daysOverdue])).toEqual([["Late", 5], ["Later", 2]]);
    expect(overdue.total).toBe(2);
    const due = (await EquipmentMaintenanceService.listDue(scopeOf(managerA), {})) as any;
    expect(due.tasks.map((t: any) => t.name)).toEqual(["Soon"]);
    expect((await EquipmentMaintenanceService.listDue(scopeOf(managerA), { withinDays: "200" }) as any).total).toBe(2);
    expect(((await EquipmentMaintenanceService.listOverdue(scopeOf(hr), {})) as any).total).toBe(3);
    expect(((await EquipmentMaintenanceService.listOverdue(scopeOf(hr), { limit: "1" })) as any).tasks).toHaveLength(1);
    await refused(EquipmentMaintenanceService.listDue(scopeOf(hr), { withinDays: "-1" }), 400);
    await refused(EquipmentMaintenanceService.listDue(scopeOf(managerA), { storeId: STORE_B }), 404);
  });

  it("completing a task moves its next due date and keeps a record; a replay or older date is refused", async () => {
    const item = await register(admin);
    const task = ((await EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "Oil", everyDays: 30, lastDoneOn: day(-40) }] })) as any).tasks[0];
    const done = (await EquipmentMaintenanceService.completeTask(task.id, null, managerA, { doneOn: day(-1), cost: 250.75, notes: "Changed" })) as any;
    expect(done).toMatchObject({ lastDoneOn: day(-1), nextDueOn: day(29) });
    expect(done.service).toMatchObject({ cost: 250.75, doneBy: "Store manager" });
    expect(db.logs[0].costPaise).toBe(25075);
    await refused(EquipmentMaintenanceService.completeTask(task.id, null, managerA, { doneOn: day(-1) }), 409, /already recorded/);
    await refused(EquipmentMaintenanceService.completeTask(task.id, null, managerA, { doneOn: day(-5) }), 409);
    await refused(EquipmentMaintenanceService.completeTask(task.id, null, managerA, { doneOn: day(2) }), 400, /future/);
    await refused(EquipmentMaintenanceService.completeTask(task.id, null, managerA, {}), 400);
  });

  it("two simultaneous submissions of the same service record exactly one", async () => {
    const item = await register(admin);
    const task = ((await EquipmentMaintenanceService.setSchedule(item.id, null, { tasks: [{ name: "Oil", everyDays: 30 }] })) as any).tasks[0];
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => EquipmentMaintenanceService.completeTask(task.id, null, admin, { doneOn: day(0) }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.logs).toHaveLength(1);
  });

  it("a manager cannot complete or read another store's task (404)", async () => {
    const b = await register(admin, { name: "B", storeId: STORE_B });
    const task = ((await EquipmentMaintenanceService.setSchedule(b.id, null, { tasks: [{ name: "Oil", everyDays: 30 }] })) as any).tasks[0];
    await refused(EquipmentMaintenanceService.completeTask(task.id, scopeOf(managerA), managerA, { doneOn: day(0) }), 404);
    await refused(EquipmentMaintenanceService.completeTask("not-a-uuid", null, admin, { doneOn: day(0) }), 404);
    expect(((await EquipmentMaintenanceService.completeTask(task.id, scopeOf(managerB), managerB, { doneOn: day(0) })) as any).lastDoneOn).toBe(day(0));
  });
});

describe("summary and replacement review", () => {
  it("counts by status, due, overdue and recent breakdowns in the caller's scope", async () => {
    const a = await register(admin, { storeId: STORE_A });
    const a2 = await register(admin, { name: "Dryer", type: "dryer", storeId: STORE_A });
    await register(admin, { name: "Other store", storeId: STORE_B });
    await OpsEquipmentService.update(a2.id, null, admin, { status: "out_of_service" });
    await EquipmentRecordsService.createRepair(a.id, null, admin, { reportedOn: day(-2), issue: "Belt" });
    await EquipmentMaintenanceService.setSchedule(a.id, null, { tasks: [{ name: "Late", everyDays: 10, lastDoneOn: day(-15) }, { name: "Soon", everyDays: 10, lastDoneOn: day(-5) }] });

    expect(await OpsEquipmentService.summary(scopeOf(managerA), {})).toEqual({
      total: 2,
      byStatus: { active: 0, under_repair: 1, out_of_service: 1, retired: 0 },
      serviceDue: 1,
      serviceOverdue: 1,
      brokenDownLast30Days: 1,
    });
    expect(((await OpsEquipmentService.summary(scopeOf(hr), {})) as any).total).toBe(3);
  });

  it("recommends by the share of the replacement cost spent on repairs in a year", () => {
    expect(recommend(10_000, 100_000)).toBe("keep");
    expect(recommend(25_000, 100_000)).toBe("monitor");
    expect(recommend(50_000, 100_000)).toBe("replace");
    expect(recommend(1, 0)).toBe("monitor");
  });

  it("lists live machines with spend, worst ratio first, and ignores retired ones and old repairs", async () => {
    const cheap = await register(admin, { name: "Iron", type: "iron", purchaseCost: 10000 });
    const big = await register(admin, { name: "Washer", purchaseCost: 200000 });
    const gone = await register(admin, { name: "Gone", purchaseCost: 1000 });
    for (const [m, cost] of [[cheap, 6000], [big, 30000], [gone, 900]] as const) {
      await EquipmentRecordsService.createRepair(m.id, null, admin, { reportedOn: day(-30), issue: "Fault", cost });
    }
    await EquipmentRecordsService.createRepair(big.id, null, admin, { reportedOn: day(-400), issue: "Ancient", cost: 99999 });
    await OpsEquipmentService.retire(gone.id, null, admin, { reason: "Scrapped" });

    const review = (await OpsEquipmentService.replacementReview(scopeOf(hr), {})) as any;
    expect(review.items.map((i: any) => [i.name, i.repairCost12Months, i.replacementCost, i.recommendation])).toEqual([
      ["Iron", 6000, 10000, "replace"],
      ["Washer", 30000, 200000, "keep"],
    ]);
    expect(review.total).toBe(2);
  });
});
