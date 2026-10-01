import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { StoreScope } from "../Middleware/StoreScope.js";
import {
  CHECK_STATUSES,
  FAULT_SEVERITIES,
  MACHINE_STATUSES,
  MACHINE_TYPES,
  type CheckStatus,
  type IMachine,
  type IMachineFilter,
  type MachineStatus,
} from "../Models/StoreFloor/StoreFloor.Interface.js";
import { BatchQuery } from "../Queries/Batch.Query.js";
import { FloorTransaction } from "../Queries/Floor.Transaction.js";
import { MachineQuery } from "../Queries/Machine.Query.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { oneOf, optionalOneOf, optionalText, parseBody, queryString, text, wholeNumber } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { actorOf, dateOnly, localDate, resolveStoreFilter } from "./FloorSupport.js";
import { MACHINE_NOT_FOUND, reserveForBatch } from "./MachineReservation.js";

const FINISHING_MINUTES = 10;
const GRAMS_PER_KG = 1000;
const MAX_RESERVATION_HOURS = 24;
const MAX_CHECKLIST_ITEMS = 50;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_CYCLE_MINUTES = 45;
const MAX_CAPACITY_KG = 500;

/** What the contract calls this machine's state right now. */
export const machineStatus = (machine: IMachine, now: Date): MachineStatus => {
  if (machine.state === "idle") return "free";
  if (machine.state === "reserved") return "reserved";
  if (machine.state === "running") {
    return machine.freeAt && machine.freeAt.getTime() - now.getTime() <= FINISHING_MINUTES * MS_PER_MINUTE ? "finishing" : "running";
  }
  return "out_of_service";
};

interface IMachineExtras {
  checkedToday?: CheckStatus | null;
  openFaults?: number;
}

export const toMachineView = (machine: IMachine, now: Date, extras: IMachineExtras = {}) => ({
  id: machine.id,
  storeId: machine.storeId,
  code: machine.code,
  name: machine.name,
  type: machine.type,
  capacityKg: machine.capacityGrams / GRAMS_PER_KG,
  status: machineStatus(machine, now),
  state: machine.state,
  currentBatchId: machine.currentBatchId,
  freeAt: machine.freeAt?.toISOString() ?? null,
  ...(extras.checkedToday !== undefined ? { checkedToday: extras.checkedToday } : {}),
  ...(extras.openFaults !== undefined ? { openFaults: extras.openFaults } : {}),
});

// A contract status is a machine state, plus for running/finishing a cut on when it frees up.
const statusFilter = (status: MachineStatus, now: Date): Pick<IMachineFilter, "states" | "finishingBefore" | "finishingAfter"> => {
  const soon = new Date(now.getTime() + FINISHING_MINUTES * MS_PER_MINUTE);
  switch (status) {
    case "free":
      return { states: ["idle"] };
    case "reserved":
      return { states: ["reserved"] };
    case "out_of_service":
      return { states: ["maintenance", "faulted"] };
    case "finishing":
      return { states: ["running"], finishingBefore: soon };
    default:
      return { states: ["running"], finishingAfter: soon };
  }
};

const decorate = async (machines: IMachine[], now: Date) => {
  const ids = machines.map((m) => m.id);
  const [checks, faults] = ids.length
    ? await Promise.all([MachineQuery.checksOn(ids, dateOnly(localDate(now))), MachineQuery.openFaultCounts(ids)])
    : [new Map<string, CheckStatus>(), new Map<string, number>()];
  return machines.map((m) => toMachineView(m, now, { checkedToday: checks.get(m.id) ?? null, openFaults: faults.get(m.id) ?? 0 }));
};

const listMachines = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const now = new Date();
    const page = parsePage(query);
    const status = optionalOneOf(queryString(query.status, "status"), MACHINE_STATUSES, "status");
    const result = await MachineQuery.search(
      {
        storeId: resolveStoreFilter(scope, query.storeId, false),
        type: optionalOneOf(queryString(query.type, "type"), MACHINE_TYPES, "type"),
        ...(status ? statusFilter(status, now) : {}),
      },
      page
    );
    return toPage(await decorate(result.items, now), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listAvailableMachines = async (scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const now = new Date();
    const storeId = resolveStoreFilter(scope, query.storeId, true) as string;
    if (!(await StoreQuery.findById(storeId, scope))) throw new CustomException("Store not found.", notFound);
    const rawAt = queryString(query.at, "at");
    const at = rawAt === undefined ? now : new Date(rawAt);
    if (Number.isNaN(at.getTime())) throw new CustomException("at must be an ISO date and time.", badRequest);
    const machines = await MachineQuery.available(
      storeId,
      optionalOneOf(queryString(query.type, "type"), MACHINE_TYPES, "type"),
      at < now ? now : at
    );
    return { machines: machines.map((m) => ({ id: m.id, name: m.name, code: m.code, type: m.type, capacityKg: m.capacityGrams / GRAMS_PER_KG, freeAt: (m.state === "idle" ? now : (m.freeAt ?? now)).toISOString() })) };
  } catch (error) {
    throw toCustomException(error);
  }
};

const requireMachine = async (id: string, scope: StoreScope): Promise<IMachine> => {
  const machine = isUuid(id) ? await MachineQuery.findById(id, scope) : null;
  if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
  return machine;
};

const getMachine = async (id: string, scope: StoreScope) => {
  try {
    const now = new Date();
    return (await decorate([await requireMachine(id, scope)], now))[0];
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------ daily checks
const parseChecklist = (value: unknown) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHECKLIST_ITEMS) {
    throw new CustomException(`checklist must list at most ${MAX_CHECKLIST_ITEMS} items.`, badRequest);
  }
  return value.map((raw, index) => {
    const entry = parseBody(raw);
    if (typeof entry.ok !== "boolean") throw new CustomException(`checklist item ${index + 1}: ok must be true or false.`, badRequest);
    const note = optionalText(entry.note, `checklist item ${index + 1}: note`, 200);
    return { item: text(entry.item, `checklist item ${index + 1}: item`, 80), ok: entry.ok, ...(note ? { note } : {}) };
  });
};

const checkView = (check: { id: string; checkDate: Date; status: string; checkedByName: string; note: string | null; checklist: unknown }) => ({
  id: check.id,
  date: check.checkDate.toISOString().slice(0, 10),
  status: check.status,
  checkedBy: check.checkedByName,
  note: check.note,
  checklist: check.checklist,
});

const recordMachineDailyCheck = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const status = oneOf(body.status, CHECK_STATUSES, "status");
    const checklist = parseChecklist(body.checklist);
    if (status === "ok" && checklist.some((entry) => !entry.ok)) {
      throw new CustomException("status must be needs_attention when a checklist item failed.", badRequest);
    }
    const note = optionalText(body.note, "note", 300) ?? null;
    const machine = await requireMachine(id, scope);
    const check = await FloorTransaction.run((tx) =>
      MachineQuery.saveCheck(
        { machineId: machine.id, storeId: machine.storeId, checkDate: dateOnly(localDate(new Date())), status, checklist, note, checkedByName: actorOf(user).byName, checkedByUserId: user.id },
        tx
      )
    );
    return checkView(check);
  } catch (error) {
    throw toCustomException(error);
  }
};

const parseDay = (value: unknown, field: string): Date | undefined => {
  const raw = queryString(value, field);
  if (raw === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(dateOnly(raw).getTime())) {
    throw new CustomException(`${field} must be a date like 2026-10-01.`, badRequest);
  }
  return dateOnly(raw);
};

const listMachineDailyChecks = async (id: string, scope: StoreScope, query: Record<string, unknown>) => {
  try {
    const machine = await requireMachine(id, scope);
    const page = parsePage(query);
    const result = await MachineQuery.listChecks(machine.id, { from: parseDay(query.from, "from"), to: parseDay(query.to, "to") }, page);
    return toPage(result.items.map(checkView), result.total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------------------ faults
// A high or stopping fault takes the machine out of service; lesser ones are logged against it.
// The repair itself belongs to the equipment register, which reads the open faults.
const reportMachineFault = async (id: string, scope: StoreScope, user: RequestUser, input: unknown) => {
  try {
    const body = parseBody(input);
    const description = text(body.description, "description", 500);
    const severity = optionalOneOf(body.severity, FAULT_SEVERITIES, "severity") ?? "medium";
    const now = new Date();

    return await FloorTransaction.run(async (tx) => {
      const machine = isUuid(id) ? await MachineQuery.lock(id, scope, tx) : null;
      if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
      const fault = await MachineQuery.addFault(
        { machineId: machine.id, storeId: machine.storeId, description, severity, reportedByName: actorOf(user).byName, reportedByUserId: user.id },
        tx
      );
      let current = machine;
      if ((severity === "high" || severity === "stopped") && machine.state !== "maintenance" && machine.state !== "faulted") {
        // A running batch keeps its machine (staff still have to take the load out); a reservation is dropped.
        const running = machine.state === "running";
        await MachineQuery.setState(machine.id, "faulted", !running, tx);
        if (!running) await BatchQuery.unassignMachine(machine.id, tx);
        current = (await MachineQuery.findById(machine.id, scope, tx)) as IMachine;
      }
      return {
        fault: { id: fault.id, description: fault.description, severity: fault.severity, status: fault.status, reportedBy: fault.reportedByName, createdAt: fault.createdAt.toISOString() },
        machine: toMachineView(current, now),
      };
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------------------- reserve / release
const reserveMachine = async (id: string, scope: StoreScope, input: unknown) => {
  try {
    const body = parseBody(input);
    if (!isUuid(body.batchId)) throw new CustomException("batchId must be a valid id.", badRequest);
    const now = new Date();
    const from = body.from === undefined ? now : new Date(String(body.from));
    const until = body.until === undefined ? null : new Date(String(body.until));
    if (Number.isNaN(from.getTime()) || (until && Number.isNaN(until.getTime()))) {
      throw new CustomException("from and until must be ISO dates and times.", badRequest);
    }
    if (until && (until <= from || until.getTime() - from.getTime() > MAX_RESERVATION_HOURS * MS_PER_HOUR)) {
      throw new CustomException(`until must be after from, within ${MAX_RESERVATION_HOURS} hours.`, badRequest);
    }

    return await FloorTransaction.run(async (tx) => {
      const machine = isUuid(id) ? await MachineQuery.findById(id, scope, tx) : null;
      if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
      const batch = await BatchQuery.findById(body.batchId as string, scope, tx);
      if (!batch || batch.storeId !== machine.storeId) throw new CustomException("Batch not found.", notFound);
      await reserveForBatch(batch, machine.id, until, tx);
      return toMachineView((await MachineQuery.findById(machine.id, scope, tx)) as IMachine, now);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const releaseMachine = async (id: string, scope: StoreScope) => {
  try {
    const now = new Date();
    return await FloorTransaction.run(async (tx) => {
      const machine = isUuid(id) ? await MachineQuery.lock(id, scope, tx) : null;
      if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
      if (machine.state === "running") {
        throw new CustomException(`${machine.name} is running a batch. Complete the batch to free it.`, conflict);
      }
      if (machine.state === "reserved") {
        if (machine.currentBatchId) await BatchQuery.setMachine(machine.currentBatchId, machine.id, null, tx);
        await MachineQuery.release(machine.id, null, tx);
      } else if (machine.state !== "idle") {
        throw new CustomException(`${machine.name} is out of service, not reserved.`, conflict);
      }
      return toMachineView((await MachineQuery.findById(machine.id, scope, tx)) as IMachine, now);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

// ------------------------------------------- service calls (equipment register)
const registerMachine = async (input: unknown) => {
  try {
    const body = parseBody(input);
    if (!isUuid(body.storeId)) throw new CustomException("storeId must be a valid id.", badRequest);
    const capacityKg = body.capacityKg;
    if (typeof capacityKg !== "number" || !Number.isFinite(capacityKg) || capacityKg <= 0 || capacityKg > MAX_CAPACITY_KG) {
      throw new CustomException(`capacityKg must be above zero and at most ${MAX_CAPACITY_KG}.`, badRequest);
    }
    const data = {
      storeId: body.storeId,
      code: text(body.code, "code", 30),
      name: text(body.name, "name", 80),
      type: oneOf(body.type, MACHINE_TYPES, "type"),
      capacityGrams: Math.round(capacityKg * GRAMS_PER_KG),
      cycleMinutes: body.cycleMinutes === undefined ? DEFAULT_CYCLE_MINUTES : wholeNumber(body.cycleMinutes, "cycleMinutes", 5, 240),
    };
    if (!(await StoreQuery.findById(data.storeId, null))) throw new CustomException("Store not found.", notFound);
    return toMachineView(await MachineQuery.register(data), new Date());
  } catch (error) {
    throw toCustomException(error);
  }
};

// The register tells us a repair finished (idle) or a machine is down for service (maintenance).
const setMachineState = async (input: unknown) => {
  try {
    const body = parseBody(input);
    if (!isUuid(body.machineId)) throw new CustomException("machineId must be a valid id.", badRequest);
    const target = oneOf(body.state, ["idle", "maintenance"] as const, "state");
    const now = new Date();
    return await FloorTransaction.run(async (tx) => {
      const machine = await MachineQuery.lock(body.machineId as string, null, tx);
      if (!machine) throw new CustomException(MACHINE_NOT_FOUND, notFound);
      if (target === "maintenance") {
        if (machine.state === "idle" || machine.state === "reserved") {
          await MachineQuery.setState(machine.id, "maintenance", true, tx);
          await BatchQuery.unassignMachine(machine.id, tx);
        } else if (machine.state === "running") {
          await MachineQuery.setState(machine.id, "maintenance", false, tx);
        }
      } else if (machine.state === "maintenance" || machine.state === "faulted") {
        await MachineQuery.resolveFaults(machine.id, tx);
        await MachineQuery.setState(machine.id, machine.currentBatchId ? "running" : "idle", false, tx);
      }
      return toMachineView((await MachineQuery.findById(machine.id, null, tx)) as IMachine, now);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const listOpenFaults = async (query: Record<string, unknown>) => {
  try {
    const storeId = queryString(query.storeId, "storeId");
    if (storeId !== undefined && !isUuid(storeId)) throw new CustomException("storeId must be a valid id.", badRequest);
    const page = parsePage(query);
    const result = await MachineQuery.listOpenFaults(storeId ?? null, page);
    return toPage(
      result.items.map((f) => ({ id: f.id, machineId: f.machineId, storeId: f.storeId, description: f.description, severity: f.severity, createdAt: f.createdAt.toISOString() })),
      result.total,
      page
    );
  } catch (error) {
    throw toCustomException(error);
  }
};

export const MachinesService = {
  listMachines,
  listAvailableMachines,
  getMachine,
  recordMachineDailyCheck,
  listMachineDailyChecks,
  reportMachineFault,
  reserveMachine,
  releaseMachine,
  registerMachine,
  setMachineState,
  listOpenFaults,
};
