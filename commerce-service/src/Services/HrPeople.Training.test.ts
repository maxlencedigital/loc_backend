jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Hr.Transaction.js", () => ({ inHrTransaction: require("../Testing/InMemoryHrPeople.js").inHrTransaction }));
jest.mock("../Queries/Employee.Query.js", () => ({ EmployeeQuery: require("../Testing/InMemoryHrPeople.js").employeeQuery, UNASSIGNED_STORE: "unassigned" }));
jest.mock("../Queries/Training.Query.js", () => ({ TrainingQuery: require("../Testing/InMemoryHrPeople.js").trainingQuery }));

import { reset, seed, state } from "../Testing/InMemoryHrPeople.js";
import { World, actor, buildWorld, ref, refused, scopeOf, setNow } from "../Testing/HrPeopleKit.js";
import { countOverdueTraining } from "./PeopleSummary.js";
import { TrainingService } from "./Training.Service.js";

let w: World;
const TODAY = "2026-10-01";
const hr = () => scopeOf(w.hr);

const course = async (over: Record<string, unknown> = {}) =>
  (await TrainingService.createCourse({ title: "Fire safety", category: "safety", ...over })) as any;
const assign = (courseId: string, employees: any[], over: Record<string, unknown> = {}, scope: string | null = null) =>
  TrainingService.assign(w.hr, scope, { courseId, employeeIds: employees.map((e) => e.id), ...over });

beforeEach(() => {
  reset();
  setNow();
  w = buildWorld();
});
afterEach(() => jest.restoreAllMocks());

describe("courses", () => {
  it("creates, reads, lists in title order and updates only what was sent", async () => {
    const b = await course({ title: "B course", durationMinutes: 30, materialUrl: "https://x.example/b", validForDays: 365 });
    await course({ title: "A course" });
    expect(b).toMatchObject({ title: "B course", durationMinutes: 30, validForDays: 365 });
    expect((await TrainingService.listCourses({})).items.map((c) => c.title)).toEqual(["A course", "B course"]);
    const updated = await TrainingService.updateCourse(b.id, { title: "B2", validForDays: null });
    expect(updated).toMatchObject({ title: "B2", validForDays: null, durationMinutes: 30, category: "safety" });
  });

  it.each([
    ["no title", { title: undefined }, /title is required/],
    ["a long title", { title: "x".repeat(121) }, /at most 120/],
    ["an unknown category", { category: "yoga" }, /category must be one of/],
    ["a zero duration", { durationMinutes: 0 }, /durationMinutes must be a whole number/],
    ["a duration over a day", { durationMinutes: 1441 }, /durationMinutes/],
    ["a plain http link", { materialUrl: "http://x.example" }, /https link/],
    ["a zero refresher interval", { validForDays: 0 }, /validForDays/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(TrainingService.createCourse({ title: "T", category: "safety", ...over }), 400, message);
    expect(state.courses.size).toBe(0);
  });

  it("refuses an empty or unknown update and a malformed id", async () => {
    const c = await course();
    await refused(TrainingService.updateCourse(c.id, {}), 400, /Nothing to update/);
    await refused(TrainingService.updateCourse("11111111-1111-4111-8111-111111111111", { title: "x" }), 404);
    await refused(TrainingService.getCourse("nope"), 404);
  });

  it("pages the list within bounds", async () => {
    for (let i = 0; i < 25; i += 1) await course({ title: `Course ${String(i).padStart(2, "0")}` });
    const first = await TrainingService.listCourses({});
    expect(first).toMatchObject({ page: 1, limit: 20, total: 25 });
    expect(first.items).toHaveLength(20);
    expect((await TrainingService.listCourses({ page: "2" })).items).toHaveLength(5);
    expect((await TrainingService.listCourses({ limit: "500" })).limit).toBe(100);
    await refused(TrainingService.listCourses({ page: "0" }), 400);
  });

  it("retires a course with nobody on it; it then disappears and cannot be assigned", async () => {
    const c = await course();
    expect(await TrainingService.deleteCourse(c.id)).toEqual({ id: c.id, deleted: true });
    await refused(TrainingService.getCourse(c.id), 404);
    await refused(assign(c.id, [w.a1]), 404, /Course not found/);
    await refused(TrainingService.deleteCourse(c.id), 404);
  });

  it("refuses to retire a course somebody still has open, and leaves it live", async () => {
    const c = await course();
    await assign(c.id, [w.a1]);
    await refused(TrainingService.deleteCourse(c.id), 409, /still have this course open/);
    expect(await TrainingService.getCourse(c.id)).toMatchObject({ id: c.id });
  });

  it("an assignment racing the retirement either lands first (and blocks it) or finds the course gone", async () => {
    const c = await course();
    const [assigned, retired] = await Promise.allSettled([assign(c.id, [w.a1]), TrainingService.deleteCourse(c.id)]);
    const open = [...state.assignments.values()].length;
    const live = [...state.courses.values()].some((x) => x.id === c.id && !x.deletedAt);
    // never a retired course holding an open assignment
    expect(open > 0 && !live).toBe(false);
    expect([assigned.status, retired.status].filter((s) => s === "fulfilled")).toHaveLength(1);
  });
});

describe("role requirements", () => {
  it("sets, replaces, normalises the role and lists", async () => {
    const a = await course({ title: "A" });
    const b = await course({ title: "B" });
    expect(await TrainingService.setRequirements(" Washer! ", { courseIds: [a.id, b.id, a.id] })).toEqual({ role: "washer", courseIds: [a.id, b.id] });
    await TrainingService.setRequirements("Rider", { courseIds: [a.id] });
    await TrainingService.setRequirements("washer", { courseIds: [b.id] });
    const roles = (await TrainingService.listRequirements()).roles;
    expect(roles).toEqual([{ role: "rider", courseIds: [a.id] }, { role: "washer", courseIds: [b.id] }]);
    await TrainingService.setRequirements("rider", { courseIds: [] });
    expect((await TrainingService.listRequirements()).roles.map((r) => r.role)).toEqual(["washer"]);
  });

  it("refuses an unknown or retired course (404) and malformed input (400) and changes nothing", async () => {
    const a = await course();
    await TrainingService.setRequirements("washer", { courseIds: [a.id] });
    await refused(TrainingService.setRequirements("washer", { courseIds: ["11111111-1111-4111-8111-111111111111"] }), 404);
    await refused(TrainingService.setRequirements("washer", { courseIds: "x" }), 400);
    await refused(TrainingService.setRequirements("washer", {}), 400);
    await refused(TrainingService.setRequirements("!!!", { courseIds: [] }), 400, /role is required/);
    expect((await TrainingService.listRequirements()).roles).toEqual([{ role: "washer", courseIds: [a.id] }]);
  });

  it("retiring a course removes it from the requirements", async () => {
    const a = await course();
    await TrainingService.setRequirements("washer", { courseIds: [a.id] });
    await TrainingService.deleteCourse(a.id);
    expect((await TrainingService.listRequirements()).roles).toEqual([]);
  });
});

describe("assigning", () => {
  it("assigns a whole group, defaulting the due date to 30 days and skipping people who already hold it", async () => {
    const c = await course({ validForDays: 365 });
    const first = await assign(c.id, [w.a1]);
    expect(first.assigned).toBe(1);
    expect(first.assignments[0]).toMatchObject({ employeeId: w.a1.id, status: "assigned", dueDate: "2026-10-31" });
    const second = await assign(c.id, [w.a1, w.a2], { dueDate: "2026-11-15" });
    expect(second).toMatchObject({ assigned: 1, skipped: [w.a1.id] });
    expect(second.assignments[0]).toMatchObject({ employeeId: w.a2.id, dueDate: "2026-11-15" });
    expect(state.assignments.size).toBe(2);
  });

  it("two simultaneous requests for the same person create one assignment", async () => {
    const c = await course();
    const results = await Promise.all([assign(c.id, [w.a1, w.a2]), assign(c.id, [w.a1, w.a2]), assign(c.id, [w.a1])]);
    expect(results.reduce((n, r) => n + r.assigned, 0)).toBe(2);
    expect(state.assignments.size).toBe(2);
  });

  it.each([
    ["no course", { courseId: undefined }, /courseId must be a valid id/],
    ["no people", { employeeIds: [] }, /employeeIds must be a list of 1 to 100/],
    ["a due date in the past", { dueDate: "2026-09-30" }, /dueDate must be from today/],
    ["a due date over a year away", { dueDate: "2027-11-01" }, /dueDate must be from today/],
    ["a malformed date", { dueDate: "tomorrow" }, /dueDate must be a date/],
  ])("refuses %s", async (_label, over, message) => {
    const c = await course();
    await refused(TrainingService.assign(w.hr, null, { courseId: c.id, employeeIds: [w.a1.id], ...over }), 400, message);
    expect(state.assignments.size).toBe(0);
  });

  it("refuses more than 100 people", async () => {
    const c = await course();
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await refused(TrainingService.assign(w.hr, null, { courseId: c.id, employeeIds: ids }), 400, /1 to 100/);
  });

  it("refuses someone who has left and an unknown person, assigning nobody", async () => {
    const c = await course();
    const gone = seed.employee({ status: "exited", storeId: w.storeA });
    await refused(assign(c.id, [w.a1, gone]), 400, /has left/);
    await refused(TrainingService.assign(w.hr, null, { courseId: c.id, employeeIds: [w.a1.id, "11111111-1111-4111-8111-111111111111"] }), 404);
    expect(state.assignments.size).toBe(0);
  });

  it("an admin looking at one store cannot assign to another store's people (404)", async () => {
    const c = await course();
    await refused(assign(c.id, [w.b1], {}, w.storeA), 404);
    expect((await assign(c.id, [w.a1], {}, w.storeA)).assigned).toBe(1);
  });
});

describe("progress and completion", () => {
  it("starts, then completes with a score and an expiry, and cannot be changed afterwards", async () => {
    const c = await course({ validForDays: 90 });
    const a = (await assign(c.id, [w.a1])).assignments[0];
    expect(await TrainingService.updateAssignment(null, a.id, { status: "in_progress" })).toMatchObject({ status: "in_progress" });
    const done = await TrainingService.updateAssignment(null, a.id, { status: "completed", score: 87.5 });
    expect(done).toMatchObject({ status: "completed", score: 87.5, expiresAt: "2026-12-30" });
    expect(done.completedAt).toBe("2026-10-01T05:00:00.000Z");
    await refused(TrainingService.updateAssignment(null, a.id, { status: "in_progress" }), 409, /completed training record/);
    await refused(TrainingService.updateAssignment(null, a.id, { status: "completed" }), 409);
    expect([...state.assignments.values()][0]).toMatchObject({ isOpen: null, scoreHundredths: 8750 });
  });

  it("goes assigned straight to completed, and in_progress cannot go back", async () => {
    const c = await course();
    const [a, b] = (await assign(c.id, [w.a1, w.a2])).assignments;
    expect(await TrainingService.updateAssignment(null, a.id, { status: "completed" })).toMatchObject({ status: "completed", expiresAt: null });
    await TrainingService.updateAssignment(null, b.id, { status: "in_progress" });
    await refused(TrainingService.updateAssignment(null, b.id, { status: "assigned" }), 409, /cannot go back/);
  });

  it.each([
    ["a score above 100", { status: "completed", score: 100.5 }, /score must be from 0 to 100/],
    ["a negative score", { status: "completed", score: -1 }, /score/],
    ["three decimals of score", { status: "completed", score: 50.123 }, /at most 2 decimals/],
    ["a completion time in the future", { status: "completed", completedAt: "2026-10-02T00:00:00Z" }, /cannot be in the future/],
    ["a completion before they joined", { status: "completed", completedAt: "2025-01-01T00:00:00Z" }, /before the person joined/],
    ["a malformed time", { status: "completed", completedAt: "yesterday" }, /ISO date and time/],
    ["a score with no completion", { status: "in_progress", score: 80 }, /recorded together with the status completed/],
    ["an unknown status", { status: "done" }, /status must be one of/],
    ["an empty body", {}, /Nothing to update/],
  ])("refuses %s", async (_label, body, message) => {
    const c = await course();
    const a = (await assign(c.id, [w.a1])).assignments[0];
    await refused(TrainingService.updateAssignment(null, a.id, body), 400, message);
    expect([...state.assignments.values()][0].status).toBe("assigned");
  });

  it("of two simultaneous completions exactly one wins", async () => {
    const c = await course({ validForDays: 30 });
    const a = (await assign(c.id, [w.a1])).assignments[0];
    const results = await Promise.allSettled([
      TrainingService.updateAssignment(null, a.id, { status: "completed", score: 90 }),
      TrainingService.updateAssignment(null, a.id, { status: "completed", score: 40 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r: any) => r.reason.errorCode)).toEqual([409]);
  });

  it("a later completion replaces the earlier one for refresher purposes", async () => {
    const c = await course({ validForDays: 30 });
    const first = (await assign(c.id, [w.a1])).assignments[0];
    await TrainingService.updateAssignment(null, first.id, { status: "completed", completedAt: "2026-08-01T05:00:00Z" });
    expect((await TrainingService.listOverdue(null, {})).total).toBe(1); // expired 2026-08-31
    const second = (await assign(c.id, [w.a1])).assignments[0];
    await TrainingService.updateAssignment(null, second.id, { status: "completed" });
    expect((await TrainingService.listOverdue(null, {})).total).toBe(0);
    expect([...state.assignments.values()].filter((a) => a.supersededAt).map((a) => a.id)).toEqual([first.id]);
  });

  it("is invisible across stores (404) and for unknown or malformed ids", async () => {
    const c = await course();
    const b = (await assign(c.id, [w.b1])).assignments[0];
    await refused(TrainingService.updateAssignment(w.storeA, b.id, { status: "in_progress" }), 404);
    await refused(TrainingService.updateAssignment(null, "nope", { status: "in_progress" }), 404);
    await refused(TrainingService.updateAssignment(null, "11111111-1111-4111-8111-111111111111", { status: "in_progress" }), 404);
  });
});

describe("listing assignments", () => {
  it("filters by person, course and status, and shows overdue ones as overdue", async () => {
    const c1 = await course({ title: "One" });
    const c2 = await course({ title: "Two" });
    await assign(c1.id, [w.a1, w.b1], { dueDate: "2026-10-01" });
    const late = (await assign(c2.id, [w.a1])).assignments[0];
    const a = [...state.assignments.values()].find((x) => x.id === late.id);
    a.nextDueOn = new Date("2026-09-01T00:00:00.000Z");
    expect((await TrainingService.listAssignments(null, {})).total).toBe(3);
    expect((await TrainingService.listAssignments(null, { employeeId: w.a1.id })).total).toBe(2);
    expect((await TrainingService.listAssignments(null, { courseId: c1.id })).total).toBe(2);
    const overdue = await TrainingService.listAssignments(null, { status: "overdue" });
    expect(overdue.items.map((x) => [x.courseTitle, x.status])).toEqual([["Two", "overdue"]]);
    expect((await TrainingService.listAssignments(null, { status: "assigned" })).total).toBe(3);
    await refused(TrainingService.listAssignments(null, { status: "bogus" }), 400);
    await refused(TrainingService.listAssignments(null, { courseId: "x" }), 400);
  });

  it("a store-scoped caller sees only that store's people, and asking for another store's person is a 404", async () => {
    const c = await course();
    await assign(c.id, [w.a1, w.b1]);
    const mine = await TrainingService.listAssignments(w.storeA, {});
    expect(mine.items.map((x) => x.employeeId)).toEqual([w.a1.id]);
    await refused(TrainingService.listAssignments(w.storeA, { employeeId: w.b1.id }), 404);
  });
});

describe("overdue and refreshers", () => {
  const overdueAssignment = async (employee: any, title: string, dueISO: string) => {
    const c = await course({ title });
    const a = (await assign(c.id, [employee])).assignments[0];
    const row = state.assignments.get(a.id);
    row.nextDueOn = new Date(`${dueISO}T00:00:00.000Z`);
    row.dueDate = row.nextDueOn;
    return row;
  };

  it("lists who is behind, most overdue first, with the days overdue", async () => {
    await overdueAssignment(w.a1, "Fire safety", "2026-09-20");
    await overdueAssignment(w.a2, "Hygiene", "2026-09-30");
    await overdueAssignment(w.a1, "On time", "2026-10-01");
    const { overdue, total } = await TrainingService.listOverdue(null, {});
    expect(total).toBe(2);
    expect(overdue).toEqual([
      { employeeId: w.a1.id, name: "Asha", courseTitle: "Fire safety", dueDate: "2026-09-20", daysOverdue: 11 },
      { employeeId: w.a2.id, name: "Bina", courseTitle: "Hygiene", dueDate: "2026-09-30", daysOverdue: 1 },
    ]);
  });

  it("leaves out people who have left, and a lapsed completion counts as overdue", async () => {
    const c = await course({ validForDays: 10 });
    const a = (await assign(c.id, [w.a1])).assignments[0];
    await TrainingService.updateAssignment(null, a.id, { status: "completed", completedAt: "2026-09-01T05:00:00Z" });
    expect((await TrainingService.listOverdue(null, {})).overdue[0]).toMatchObject({ employeeId: w.a1.id, dueDate: "2026-09-11", daysOverdue: 20 });
    state.employees.get(w.a1.id).status = "exited";
    expect((await TrainingService.listOverdue(null, {})).total).toBe(0);
    expect(await countOverdueTraining(null)).toBe(0);
  });

  it("a manager sees only their own store; another store's id is a 404", async () => {
    await overdueAssignment(w.a1, "A", "2026-09-01");
    await overdueAssignment(w.b1, "B", "2026-09-01");
    const scope = scopeOf(w.managerA);
    expect((await TrainingService.listOverdue(scope, {})).overdue.map((r) => r.name)).toEqual(["Asha"]);
    await refused(TrainingService.listOverdue(scope, { storeId: w.storeB }), 404);
    expect((await TrainingService.listOverdue(null, { storeId: w.storeB })).overdue.map((r) => r.name)).toEqual(["Chitra"]);
    expect(await countOverdueTraining(scope)).toBe(1);
    expect(await countOverdueTraining(null)).toBe(2);
  });

  it("pages the overdue list within bounds", async () => {
    const c = await course();
    const people = Array.from({ length: 30 }, (_, i) => seed.employee({ name: `P${i}`, storeId: w.storeA }));
    await assign(c.id, people.slice(0, 30).slice(0, 30));
    for (const row of state.assignments.values()) row.nextDueOn = new Date("2026-09-01T00:00:00.000Z");
    const first = await TrainingService.listOverdue(null, {});
    expect(first).toMatchObject({ page: 1, limit: 20, total: 30 });
    expect(first.overdue).toHaveLength(20);
    expect((await TrainingService.listOverdue(null, { page: "2", limit: "20" })).overdue).toHaveLength(10);
    expect((await TrainingService.listOverdue(null, { limit: "1000" })).limit).toBe(100);
  });

  it("lists refreshers coming due within a window (default 30 days), soonest first", async () => {
    const c = await course({ title: "CPR", validForDays: 20 });
    const [a, b] = (await assign(c.id, [w.a1, w.a2])).assignments;
    await TrainingService.updateAssignment(null, a.id, { status: "completed", completedAt: "2026-10-01T05:00:00Z" }); // due 10-21
    await TrainingService.updateAssignment(null, b.id, { status: "completed", completedAt: "2026-09-20T05:00:00Z" }); // due 10-10
    expect((await TrainingService.listRefreshersDue(null, {})).refreshers.map((r) => [r.name, r.dueOn])).toEqual([["Bina", "2026-10-10"], ["Asha", "2026-10-21"]]);
    expect((await TrainingService.listRefreshersDue(null, { withinDays: "10" })).refreshers.map((r) => r.name)).toEqual(["Bina"]);
    await refused(TrainingService.listRefreshersDue(null, { withinDays: "0" }), 400);
    await refused(TrainingService.listRefreshersDue(null, { withinDays: "181" }), 400);
    await refused(TrainingService.listRefreshersDue(null, { withinDays: "soon" }), 400);
    await refused(TrainingService.listRefreshersDue(scopeOf(w.managerA), { storeId: w.storeB }), 404);
  });
});

describe("self-service", () => {
  it("lists, starts and completes only my own assignments", async () => {
    const c = await course({ materialUrl: "https://x.example/m" });
    const mine = (await assign(c.id, [w.a1])).assignments[0];
    const theirs = (await assign(c.id, [w.a2])).assignments[0];
    expect((await TrainingService.listMine(ref(w.a1))).assignments).toEqual([
      { id: mine.id, courseTitle: "Fire safety", status: "assigned", dueDate: "2026-10-31", materialUrl: "https://x.example/m" },
    ]);
    expect(await TrainingService.startMine(ref(w.a1), mine.id)).toMatchObject({ status: "in_progress" });
    expect(await TrainingService.completeMine(ref(w.a1), mine.id, { score: 70 })).toMatchObject({ status: "completed", score: 70 });
    await refused(TrainingService.startMine(ref(w.a1), theirs.id), 404);
    await refused(TrainingService.completeMine(ref(w.a1), theirs.id, {}), 404);
    await refused(TrainingService.completeMine(ref(w.a1), mine.id, {}), 409);
    await refused(TrainingService.startMine(ref(w.a1), mine.id), 409);
  });
});

void actor;
