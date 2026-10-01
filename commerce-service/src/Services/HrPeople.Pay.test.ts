jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Hr.Transaction.js", () => ({ inHrTransaction: require("../Testing/InMemoryHrPeople.js").inHrTransaction }));
jest.mock("../Queries/Employee.Query.js", () => ({ EmployeeQuery: require("../Testing/InMemoryHrPeople.js").employeeQuery, UNASSIGNED_STORE: "unassigned" }));
jest.mock("../Queries/Pay.Query.js", () => ({ PayQuery: require("../Testing/InMemoryHrPeople.js").payQuery }));
jest.mock("../Queries/Attendance.Query.js", () => ({ AttendanceQuery: require("../Testing/InMemoryHrPeople.js").attendanceQuery }));
jest.mock("../Queries/Leave.Query.js", () => ({ LeaveQuery: require("../Testing/InMemoryHrPeople.js").leaveQuery }));
jest.mock("../Queries/Holiday.Query.js", () => ({ HolidayQuery: require("../Testing/InMemoryHrPeople.js").holidayQuery }));

import { reset, seed, state } from "../Testing/InMemoryHrPeople.js";
import { World, actor, buildWorld, ref, refused, scopeOf, setNow } from "../Testing/HrPeopleKit.js";
import { PayService } from "./Pay.Service.js";

let w: World;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const setPay = (employee: any, over: Record<string, unknown> = {}, scope: string | null = null) =>
  PayService.setCompensation(w.hr, employee.id, scope, { baseSalary: 30000, effectiveFrom: "2026-01-01", ...over }) as Promise<any>;

const makeScheme = async (over: Record<string, unknown> = {}) =>
  (await PayService.createScheme({
    name: "Jobs bonus", appliesTo: "rider", metric: "jobs_completed", period: "monthly",
    rules: [{ threshold: 20, reward: 500 }, { threshold: 40, reward: 1500 }], ...over,
  })) as any;

const report = (employee: any, value: number, over: Record<string, unknown> = {}) =>
  PayService.ingestMetrics({ metrics: [{ employeeId: employee.id, metric: "jobs_completed", period: "2026-09", value, ...over }] });

const attend = (employee: any, from: string, count: number) => {
  for (let i = 0; i < count; i += 1) {
    state.attendance.push({ employeeId: employee.id, storeId: employee.storeId, date: new Date(d(from).getTime() + i * 86_400_000), status: "present" });
  }
};

let rider: any;
beforeEach(() => {
  reset();
  setNow();
  w = buildWorld();
  rider = seed.employee({ name: "Ravi", employeeType: "rider", storeId: w.storeA });
});
afterEach(() => jest.restoreAllMocks());

describe("pay terms", () => {
  it("sets and reads salary, allowances and bonus eligibility in rupees, and keeps every version", async () => {
    const first = await setPay(w.a1, { allowances: { travel: 1500.5 }, bonusEligible: true });
    expect(first).toMatchObject({ baseSalary: 30000, payCycle: "monthly", allowances: { travel: 1500.5 }, bonusEligible: true, effectiveFrom: "2026-01-01" });
    const raised = await setPay(w.a1, { baseSalary: 33000, effectiveFrom: "2026-09-01", payCycle: "weekly" });
    expect(raised).toMatchObject({ baseSalary: 33000, payCycle: "weekly", effectiveFrom: "2026-09-01" });
    expect(raised.history.map((h: any) => h.baseSalary)).toEqual([33000, 30000]);
    expect(state.compensation).toHaveLength(2);
    expect(state.compensation[0].baseSalaryPaise).toBe(3_000_000);
  });

  it("shows what is in force today and what is coming", async () => {
    await setPay(w.a1);
    const result = await setPay(w.a1, { baseSalary: 40000, effectiveFrom: "2026-11-01" });
    expect(result).toMatchObject({ baseSalary: 30000, upcoming: { baseSalary: 40000, effectiveFrom: "2026-11-01" } });
  });

  it("never rewrites history: new terms must start after the latest, and only one of two racing writes wins", async () => {
    await setPay(w.a1, { effectiveFrom: "2026-06-01" });
    await refused(setPay(w.a1, { effectiveFrom: "2026-06-01" }), 409, /after the latest pay terms/);
    await refused(setPay(w.a1, { effectiveFrom: "2026-03-01" }), 409, /after the latest pay terms/);
    const results = await Promise.allSettled([setPay(w.a1, { effectiveFrom: "2026-07-01", baseSalary: 1 }), setPay(w.a1, { effectiveFrom: "2026-07-01", baseSalary: 2 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.compensation.filter((c) => c.employeeId === w.a1.id)).toHaveLength(2);
  });

  it.each([
    ["no salary", { baseSalary: undefined }, /baseSalary must be an amount/],
    ["a negative salary", { baseSalary: -1 }, /baseSalary/],
    ["paise fractions", { baseSalary: 100.005 }, /at most two decimals/],
    ["a text salary", { baseSalary: "30000" }, /baseSalary/],
    ["an absurd salary", { baseSalary: 1e9 }, /too large/],
    ["an unknown pay cycle", { payCycle: "daily" }, /payCycle must be one of/],
    ["allowances as a list", { allowances: [1] }, /allowances must be an object/],
    ["a bad allowance amount", { allowances: { food: -5 } }, /allowance food/],
    ["too many allowances", { allowances: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`a${i}`, 1])) }, /at most 20/],
    ["a text bonus flag", { bonusEligible: "yes" }, /bonusEligible must be true or false/],
    ["no start date", { effectiveFrom: undefined }, /effectiveFrom must be a date/],
    ["a start before they joined", { effectiveFrom: "2025-12-31" }, /before the person joined/],
    ["a start over a year ahead", { effectiveFrom: "2027-10-03" }, /at most 366 days ahead/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(setPay(w.a1, over), 400, message);
    expect(state.compensation).toHaveLength(0);
  });

  it("accepts a zero base for per-job pay, refuses someone who has left, and 404s for the wrong store or person", async () => {
    expect(await setPay(w.a1, { baseSalary: 0, payCycle: "per_job" })).toMatchObject({ baseSalary: 0, payCycle: "per_job" });
    const gone = seed.employee({ status: "exited", storeId: w.storeA });
    await refused(setPay(gone), 409, /has left/);
    await refused(setPay(w.b1, {}, w.storeA), 404);
    await refused(PayService.getCompensation(w.b1.id, w.storeA), 404);
    await refused(PayService.getCompensation("nope", null), 404);
  });

  it("answers 404 when nothing is in force", async () => {
    await refused(PayService.getCompensation(w.a1.id, null), 404, /No pay terms/);
    await setPay(w.a1, { effectiveFrom: "2026-12-01" });
    await refused(PayService.getCompensation(w.a1.id, null), 404, /No pay terms/);
  });

  it("gives an employee only salary, cycle and bonus eligibility of their own terms", async () => {
    await setPay(w.a1, { allowances: { travel: 100 }, bonusEligible: true });
    expect(await PayService.getMyCompensation(ref(w.a1))).toEqual({ baseSalary: 30000, payCycle: "monthly", bonusEligible: true });
    await refused(PayService.getMyCompensation(ref(w.a2)), 404);
  });
});

describe("incentive schemes", () => {
  it("creates with sorted tiers in paise and thousandths, lists, reads and updates", async () => {
    const s = await makeScheme({ rules: [{ threshold: 40, reward: 1500 }, { threshold: 20, reward: 500 }] });
    expect(s.rules).toEqual([{ threshold: 20, reward: 500 }, { threshold: 40, reward: 1500 }]);
    expect(state.schemes.get(s.id).rules).toEqual([{ thresholdMilli: 20000, rewardPaise: 50000 }, { thresholdMilli: 40000, rewardPaise: 150000 }]);
    await makeScheme({ name: "A first" });
    expect((await PayService.listSchemes({})).items.map((x) => x.name)).toEqual(["A first", "Jobs bonus"]);
    expect(await PayService.getScheme(s.id)).toMatchObject({ id: s.id, isActive: true });
    const updated = await PayService.updateScheme(s.id, { isActive: false, rules: [{ threshold: 5, reward: 10 }] });
    expect(updated).toMatchObject({ isActive: false, rules: [{ threshold: 5, reward: 10 }], name: "Jobs bonus" });
  });

  it.each([
    ["no name", { name: undefined }, /name is required/],
    ["an unknown audience", { appliesTo: "all" }, /appliesTo must be one of/],
    ["an unknown metric", { metric: "smiles" }, /metric must be one of/],
    ["no rules", { rules: [] }, /1 to 10 thresholds/],
    ["eleven rules", { rules: Array.from({ length: 11 }, (_, i) => ({ threshold: i + 1, reward: 1 })) }, /1 to 10 thresholds/],
    ["a repeated threshold", { rules: [{ threshold: 5, reward: 1 }, { threshold: 5, reward: 2 }] }, /once/],
    ["a zero reward", { rules: [{ threshold: 5, reward: 0 }] }, /reward must be more than zero/],
    ["a zero threshold", { rules: [{ threshold: 0, reward: 5 }] }, /threshold/],
    ["a rating threshold above 5", { metric: "rating", rules: [{ threshold: 6, reward: 5 }] }, /threshold/],
    ["a weekly attendance scheme", { metric: "attendance", period: "weekly" }, /evaluated monthly/],
    ["an unknown period", { period: "yearly" }, /period must be one of/],
  ])("refuses %s", async (_label, over, message) => {
    await refused(makeScheme(over), 400, message);
    expect(state.schemes.size).toBe(0);
  });

  it("refuses bad edits and unknown schemes", async () => {
    const s = await makeScheme();
    await refused(PayService.updateScheme(s.id, {}), 400, /Nothing to update/);
    await refused(PayService.updateScheme(s.id, { metric: "attendance", period: "daily" }), 400);
    await refused(PayService.updateScheme("11111111-1111-4111-8111-111111111111", { name: "x" }), 404);
    await refused(PayService.getScheme("nope"), 404);
  });

  it("assigns only to people the scheme applies to, once each, and not when switched off", async () => {
    const s = await makeScheme();
    expect(await PayService.assignScheme(w.hr, s.id, null, { employeeIds: [rider.id] })).toMatchObject({ assigned: 1, alreadyAssigned: 0 });
    expect(await PayService.assignScheme(w.hr, s.id, null, { employeeIds: [rider.id] })).toMatchObject({ assigned: 0, alreadyAssigned: 1 });
    await refused(PayService.assignScheme(w.hr, s.id, null, { employeeIds: [w.a1.id] }), 400, /applies to rider only/);
    const gone = seed.employee({ employeeType: "rider", status: "exited" });
    await refused(PayService.assignScheme(w.hr, s.id, null, { employeeIds: [gone.id] }), 400, /has left/);
    await refused(PayService.assignScheme(w.hr, s.id, w.storeB, { employeeIds: [rider.id] }), 404);
    await PayService.updateScheme(s.id, { isActive: false });
    await refused(PayService.assignScheme(w.hr, s.id, null, { employeeIds: [rider.id] }), 409, /switched off/);
    await refused(PayService.assignScheme(w.hr, s.id, null, { employeeIds: [] }), 400);
    const staff = await makeScheme({ name: "Staff", appliesTo: "staff" });
    expect((await PayService.assignScheme(w.hr, staff.id, null, { employeeIds: [w.a1.id, w.managerPersonA.id] })).assigned).toBe(2);
  });
});

describe("reported metrics become incentives", () => {
  let scheme: any;
  beforeEach(async () => {
    scheme = await makeScheme();
    await PayService.assignScheme(w.hr, scheme.id, null, { employeeIds: [rider.id] });
  });
  const earnings = () => [...state.earnings.values()];

  it("creates a pending earning at the highest tier reached, and follows a corrected value while pending", async () => {
    expect(await report(rider, 25)).toEqual({ accepted: 1, ignored: 0 });
    expect(earnings()).toMatchObject([{ employeeId: rider.id, schemeName: "Jobs bonus", period: "2026-09", rewardPaise: 50000, status: "pending", metricValueMilli: 25000 }]);
    await report(rider, 45);
    expect(earnings()).toHaveLength(1);
    expect(earnings()[0]).toMatchObject({ rewardPaise: 150000, metricValueMilli: 45000 });
    await report(rider, 10);
    expect(earnings()[0].rewardPaise).toBe(0);
  });

  it("creates nothing below the first tier, and ignores a scheme of another period kind", async () => {
    await report(rider, 5);
    expect(earnings()).toHaveLength(0);
    await PayService.ingestMetrics({ metrics: [{ employeeId: rider.id, metric: "jobs_completed", period: "2026-W38", value: 99 }] });
    expect(earnings()).toHaveLength(0);
    expect(state.metrics.size).toBe(2);
  });

  it("evaluates weekly and daily schemes on their own period keys", async () => {
    const weekly = await makeScheme({ name: "Weekly", period: "weekly", rules: [{ threshold: 10, reward: 100 }] });
    await PayService.assignScheme(w.hr, weekly.id, null, { employeeIds: [rider.id] });
    await PayService.ingestMetrics({ metrics: [{ employeeId: rider.id, metric: "jobs_completed", period: "2026-W38", value: 12 }] });
    expect(earnings()).toMatchObject([{ schemeName: "Weekly", period: "2026-W38", periodStart: d("2026-09-14"), periodEnd: d("2026-09-20") }]);
  });

  it("never changes an incentive once approved or paid", async () => {
    await report(rider, 25);
    const id = earnings()[0].id;
    state.earnings.get(id).status = "approved";
    await report(rider, 99);
    expect(earnings()[0]).toMatchObject({ rewardPaise: 50000, metricValueMilli: 25000, status: "approved" });
  });

  it("ignores people who are unknown or have left, and validates the rest of the batch", async () => {
    const gone = seed.employee({ employeeType: "rider", status: "exited" });
    const result = await PayService.ingestMetrics({
      metrics: [
        { employeeId: rider.id, metric: "jobs_completed", period: "2026-09", value: 30 },
        { employeeId: gone.id, metric: "jobs_completed", period: "2026-09", value: 30 },
        { employeeId: "11111111-1111-4111-8111-111111111111", metric: "jobs_completed", period: "2026-09", value: 30 },
      ],
    });
    expect(result).toEqual({ accepted: 1, ignored: 2 });
  });

  it.each([
    ["no metrics", {}, /metrics must list 1 to 200/],
    ["more than 200", { metrics: Array.from({ length: 201 }, () => ({})) }, /1 to 200/],
    ["the attendance metric", { metrics: [{ employeeId: "E", metric: "attendance", period: "2026-09", value: 1 }] }, /computed from the attendance records/],
    ["an unknown metric", { metrics: [{ employeeId: "E", metric: "x", period: "2026-09", value: 1 }] }, /metric must be one of/],
    ["a bad period", { metrics: [{ employeeId: "E", metric: "distance", period: "Sept", value: 1 }] }, /period must be/],
    ["a negative value", { metrics: [{ employeeId: "E", metric: "distance", period: "2026-09", value: -1 }] }, /value must be from 0/],
    ["a rating over 5", { metrics: [{ employeeId: "E", metric: "rating", period: "2026-09", value: 5.5 }] }, /value must be from 0 to 5/],
    ["a bad employee id", { metrics: [{ employeeId: "nope", metric: "distance", period: "2026-09", value: 1 }] }, /employeeId must be a valid id/],
  ])("refuses %s, storing nothing", async (_label, body, message) => {
    const fixed = JSON.parse(JSON.stringify(body).replace(/"E"/g, `"${rider.id}"`));
    await refused(PayService.ingestMetrics(fixed), 400, message);
    expect(state.metrics.size).toBe(0);
  });

  it("lists incentives by status, person and period (month or exact key), and keeps stores apart", async () => {
    await report(rider, 25);
    const other = seed.employee({ name: "Other", employeeType: "rider", storeId: w.storeB });
    await PayService.assignScheme(w.hr, scheme.id, null, { employeeIds: [other.id] });
    await report(other, 45);
    expect((await PayService.listIncentiveEarnings(null, {})).total).toBe(2);
    expect((await PayService.listIncentiveEarnings(null, { period: "2026-09" })).total).toBe(2);
    expect((await PayService.listIncentiveEarnings(null, { period: "2026-08" })).total).toBe(0);
    expect((await PayService.listIncentiveEarnings(null, { employeeId: rider.id })).items[0]).toMatchObject({ scheme: "Jobs bonus", amount: 500, status: "pending", period: "2026-09", employeeName: "Ravi" });
    expect((await PayService.listIncentiveEarnings(w.storeA, {})).items.map((i) => i.employeeName)).toEqual(["Ravi"]);
    await refused(PayService.listIncentiveEarnings(w.storeA, { employeeId: other.id }), 404);
    await refused(PayService.listIncentiveEarnings(null, { status: "x" }), 400);
    await refused(PayService.listIncentiveEarnings(null, { period: "x".repeat(20) }), 400);
  });

  it("approves once, only after the period has ended, and not across stores", async () => {
    await report(rider, 25);
    const id = earnings()[0].id;
    expect(await PayService.approveIncentiveEarning(w.hr, id, null)).toMatchObject({ status: "approved", amount: 500 });
    expect(earnings()[0]).toMatchObject({ approvedByName: "Hema HR" });
    await refused(PayService.approveIncentiveEarning(w.hr, id, null), 409, /already been approved/);
    await refused(PayService.approveIncentiveEarning(w.hr, id, w.storeB), 404);
    await refused(PayService.approveIncentiveEarning(w.hr, "nope", null), 404);
    await PayService.ingestMetrics({ metrics: [{ employeeId: rider.id, metric: "jobs_completed", period: "2026-10", value: 30 }] });
    const running = earnings().find((e) => e.period === "2026-10");
    await refused(PayService.approveIncentiveEarning(w.hr, running.id, null), 409, /period has ended/);
  });

  it("of two simultaneous approvals one wins", async () => {
    await report(rider, 25);
    const id = earnings()[0].id;
    const results = await Promise.allSettled([PayService.approveIncentiveEarning(w.hr, id, null), PayService.approveIncentiveEarning(w.hr, id, null)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("what someone earned in a month", () => {
  beforeEach(async () => {
    await setPay(w.a1, { baseSalary: 30000, allowances: { travel: 3000 } });
    attend(w.a1, "2026-09-01", 27); // the last 3 days of September are absent
  });

  it("prorates base and allowances by the days paid, and totals what is due", async () => {
    const e = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-09" });
    expect(e).toMatchObject({ month: "2026-09", base: 27000, allowances: 2700, payableDays: 27, unpaidDays: 3, provisional: false, bonuses: 0, paid: 0, due: 29700, totalEarned: 29700, incentives: [] });
  });

  it("counts approved incentives and recorded bonuses, and nets payments off", async () => {
    const scheme = await makeScheme({ name: "Attend", appliesTo: "both", metric: "attendance", rules: [{ threshold: 20, reward: 500 }] });
    await PayService.assignScheme(w.hr, scheme.id, null, { employeeIds: [w.a1.id] });
    const first = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-09" });
    expect(first.incentives).toEqual([{ scheme: "Attend", earned: 500, status: "pending" }]);
    expect(first.totalEarned).toBe(29700); // a pending incentive is not counted yet
    const id = [...state.earnings.values()][0].id;
    await PayService.approveIncentiveEarning(w.hr, id, null);
    await PayService.recordPayout(w.hr, null, { employeeId: w.a1.id, amount: 1000, type: "bonus", period: "2026-09", paidOn: "2026-09-30" }, null);
    await PayService.recordPayout(w.hr, null, { employeeId: w.a1.id, amount: 20000, type: "salary", period: "2026-09", paidOn: "2026-09-30" }, null);
    const e = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-09" });
    expect(e).toMatchObject({ bonuses: 1000, totalEarned: 29700 + 500 + 1000, paid: 21000, due: 10200, overpaid: 0 });
    expect((await PayService.getMyEarnings(ref(w.a1), { month: "2026-09" }))).not.toHaveProperty("employeeId");
  });

  it("shows overpayment instead of a negative due", async () => {
    await PayService.recordPayout(w.hr, null, { employeeId: w.a1.id, amount: 40000, type: "advance", period: "2026-09", paidOn: "2026-09-30" }, null);
    const e = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-09" });
    expect(e).toMatchObject({ due: 0, overpaid: 10300 });
  });

  it("projects a running month as paid and marks it provisional", async () => {
    const e = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-10" });
    // 1 Oct has no clock-in yet but is not over; the other 30 days are projected: a full month
    expect(e).toMatchObject({ provisional: true, payableDays: 31, base: 30000, allowances: 3000 });
  });

  it("splits a month where the salary changed", async () => {
    await setPay(w.a1, { baseSalary: 60000, effectiveFrom: "2026-09-16" });
    attend(w.a1, "2026-09-28", 3);
    const e = await PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-09" });
    // 30 payable days: 15 at 30,000 and 15 at 60,000 over 30 days
    expect(e.base).toBe(15000 + 30000);
  });

  it("rejects a bad month and other stores' people", async () => {
    await refused(PayService.getEmployeeEarnings(w.a1.id, null, { month: "2026-13" }), 400, /month must be a month/);
    await refused(PayService.getEmployeeEarnings(w.b1.id, scopeOf(w.managerA), {}), 404);
    await refused(PayService.getEmployeeEarnings("nope", null, {}), 404);
  });

  it("reads zero pay for a person with no terms yet", async () => {
    attend(w.a2, "2026-09-01", 30);
    expect(await PayService.getEmployeeEarnings(w.a2.id, null, { month: "2026-09" })).toMatchObject({ base: 0, totalEarned: 0, due: 0 });
  });
});

describe("recording payouts", () => {
  const pay = (over: Record<string, unknown> = {}, key: string | null = null, scope: string | null = null, user = w.hr) =>
    PayService.recordPayout(user, scope, { employeeId: w.a1.id, amount: 1000, type: "salary", period: "2026-09", paidOn: "2026-09-30", reference: "UTR123", ...over }, key);

  it("records and lists payments, newest first, in rupees", async () => {
    expect(await pay()).toMatchObject({ amount: 1000, type: "salary", period: "2026-09", paidOn: "2026-09-30", reference: "UTR123", employeeName: "Asha" });
    await pay({ paidOn: "2026-10-01", type: "bonus", amount: 250.5 });
    const list = await PayService.listPayouts(null, {});
    expect(list.items.map((p) => [p.type, p.amount])).toEqual([["bonus", 250.5], ["salary", 1000]]);
    expect((await PayService.listPayouts(null, { type: "bonus" })).total).toBe(1);
    expect((await PayService.listPayouts(null, { from: "2026-10-01" })).total).toBe(1);
    expect((await PayService.listPayouts(null, { employeeId: w.a2.id })).total).toBe(0);
    expect(state.payouts[0].amountPaise).toBe(100000);
    await refused(PayService.listPayouts(null, { type: "x" }), 400);
    await refused(PayService.listPayouts(null, { from: "x" }), 400);
    expect((await PayService.listMyPayouts(ref(w.a1), {})).items).toEqual([expect.objectContaining({ type: "bonus" }), expect.objectContaining({ type: "salary" })]);
    expect((await PayService.listMyPayouts(ref(w.a1), {})).items[0]).not.toHaveProperty("employeeId");
  });

  it.each([
    ["no amount", { amount: undefined }, /amount must be an amount/],
    ["a zero amount", { amount: 0 }, /more than zero/],
    ["a fractional paisa", { amount: 10.001 }, /at most two decimals/],
    ["an enormous amount", { amount: 20_000_000 }, /too large/],
    ["an unknown type", { type: "gift" }, /type must be one of/],
    ["a future paid date", { paidOn: "2026-10-02" }, /paidOn cannot be in the future/],
    ["a paid date before joining", { paidOn: "2025-12-31" }, /before the person joined/],
    ["a future month", { period: "2026-11" }, /future month/],
    ["a malformed month", { period: "Sept" }, /period must be a month/],
    ["a long reference", { reference: "x".repeat(81) }, /at most 80/],
    ["no person", { employeeId: undefined }, /employeeId must be a valid id/],
  ])("refuses %s, recording nothing", async (_label, over, message) => {
    await refused(pay(over), 400, message);
    expect(state.payouts).toHaveLength(0);
  });

  it("is invisible across stores (404)", async () => {
    await refused(pay({ employeeId: w.b1.id }, null, w.storeA), 404);
  });

  it("replays an Idempotency-Key as the original, refuses the key for a different payout, and races to one row", async () => {
    const first = await pay({}, "key-abcdef-1");
    const again = await pay({}, "key-abcdef-1");
    expect(again.id).toBe(first.id);
    expect(state.payouts).toHaveLength(1);
    await refused(pay({ amount: 999 }, "key-abcdef-1"), 409, /different payout/);
    const raced = await Promise.all([pay({ amount: 5 }, "key-race-0001"), pay({ amount: 5 }, "key-race-0001"), pay({ amount: 5 }, "key-race-0001")]);
    expect(new Set(raced.map((r) => r.id)).size).toBe(1);
    expect(state.payouts).toHaveLength(2);
    // the same key from another recorder is a different request
    await pay({}, "key-abcdef-1", null, actor("admin", null, "Anil", "11111111-1111-4111-8111-111111111111"));
    expect(state.payouts).toHaveLength(3);
  });

  describe("incentive payouts", () => {
    let earningIds: string[];
    beforeEach(async () => {
      const scheme = await makeScheme({ appliesTo: "both", rules: [{ threshold: 1, reward: 600 }] });
      const scheme2 = await makeScheme({ name: "Second", appliesTo: "both", rules: [{ threshold: 1, reward: 400 }] });
      for (const s of [scheme, scheme2]) await PayService.assignScheme(w.hr, s.id, null, { employeeIds: [w.a1.id] });
      await report(w.a1, 5);
      earningIds = [...state.earnings.values()].map((e) => e.id);
      for (const id of earningIds) await PayService.approveIncentiveEarning(w.hr, id, null);
    });
    const incentive = (amount: number) => pay({ type: "incentive", amount });
    const statuses = () => [...state.earnings.values()].map((e) => `${e.rewardPaise}:${e.status}`).sort();

    it("cannot exceed what was approved for the month", async () => {
      await refused(incentive(1000.01), 409, /more than the approved incentives/);
      await refused(pay({ type: "incentive", amount: 1, period: "2026-08" }), 409, /more than the approved incentives/);
      expect(state.payouts).toHaveLength(0);
    });

    it("marks earnings paid, oldest first and whole ones only, as the payments cover them", async () => {
      await incentive(300);
      expect(statuses()).toEqual(["40000:approved", "60000:approved"]);
      await incentive(300);
      const paid = [...state.earnings.values()].filter((e) => e.status === "paid");
      expect(paid).toHaveLength(1);
      await incentive(400);
      expect(statuses()).toEqual(["40000:paid", "60000:paid"]);
      await refused(incentive(0.01), 409);
    });

    it("two simultaneous payouts cannot together exceed the approved total", async () => {
      const results = await Promise.allSettled([incentive(700), incentive(700)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(state.payouts.reduce((n, p) => n + p.amountPaise, 0)).toBe(70000);
    });

    it("pending incentives cannot be paid", async () => {
      await PayService.ingestMetrics({ metrics: [{ employeeId: w.a1.id, metric: "jobs_completed", period: "2026-08", value: 5 }] });
      await refused(pay({ type: "incentive", amount: 1, period: "2026-08" }), 409);
    });
  });
});

void actor;
