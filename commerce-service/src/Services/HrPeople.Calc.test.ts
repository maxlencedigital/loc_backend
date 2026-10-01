import { PayTerms, calculateMonthPay, earningsCoveredBy, payDaysOf, periodKeyOf, periodRangeOf, rewardFor, termsInForce, weekKeyOf } from "./PayCalc.js";
import { measuresOf, scoreOf, toMetrics, trendOf } from "./PerformanceScore.js";
import { rankScores } from "./Performance.Service.js";
import { divideHalfUp, parseMilli, parsePaise, parseScore } from "../Utils/PeopleInput.js";
import { derivedStatus, expiryOf } from "./Training.Service.js";
import { slaBreached } from "./Grievance.Service.js";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const days = (from: string, to: string, payable = true) => {
  const out = [];
  for (let t = d(from); t <= d(to); t = new Date(t.getTime() + 86_400_000)) out.push({ date: t, payable });
  return out;
};
const terms = (over: Partial<PayTerms> = {}): PayTerms => ({
  effectiveFrom: d("2026-01-01"),
  baseSalaryPaise: 3_000_000,
  payCycle: "monthly",
  allowancesPaise: 0,
  ...over,
});
const SEPT = { from: d("2026-09-01"), to: d("2026-09-30") };

describe("rounding half up", () => {
  it.each([
    [1, 2, 1],
    [1, 3, 0],
    [2, 3, 1],
    [5, 10, 1],
    [4, 10, 0],
    [100, 7, 14],
    [0, 5, 0],
  ])("%i over %i is %i", (n, den, expected) => expect(divideHalfUp(n, den)).toBe(expected));
});

describe("monthly pay, day by day", () => {
  // ₹30,000 over a 30-day month is exactly ₹1,000 a day.
  it.each([
    ["every day paid", days("2026-09-01", "2026-09-30"), 3_000_000, 30, 0],
    ["three unpaid days", [...days("2026-09-01", "2026-09-27"), ...days("2026-09-28", "2026-09-30", false)], 2_700_000, 27, 3],
    ["half the month", days("2026-09-01", "2026-09-15"), 1_500_000, 15, 0],
    ["nobody paid", days("2026-09-01", "2026-09-30", false), 0, 0, 30],
    ["no days at all (not employed)", [], 0, 0, 0],
  ])("%s", (_label, payDays, base, payable, unpaid) => {
    expect(calculateMonthPay(SEPT, [terms()], payDays)).toMatchObject({ basePaise: base, payableDays: payable, unpaidDays: unpaid });
  });

  it("rounds the paise half up, once, not per day", () => {
    // 10,000 paise over 30 days is 333.33.. a day; 7 days is 2333.33 -> 2333; 8 days is 2666.67 -> 2667
    expect(calculateMonthPay(SEPT, [terms({ baseSalaryPaise: 10_000 })], days("2026-09-01", "2026-09-07")).basePaise).toBe(2333);
    expect(calculateMonthPay(SEPT, [terms({ baseSalaryPaise: 10_000 })], days("2026-09-01", "2026-09-08")).basePaise).toBe(2667);
    // exactly half a paisa rounds up: 1 paise x 15 / 30 = 0.5 -> 1
    expect(calculateMonthPay(SEPT, [terms({ baseSalaryPaise: 1 })], days("2026-09-01", "2026-09-15")).basePaise).toBe(1);
  });

  it("splits a month over the terms in force each day", () => {
    const raise = [terms(), terms({ effectiveFrom: d("2026-09-16"), baseSalaryPaise: 6_000_000 })];
    // 15 days at 30,000 and 15 days at 60,000 of a 30-day month
    expect(calculateMonthPay(SEPT, raise, days("2026-09-01", "2026-09-30")).basePaise).toBe(1_500_000 + 3_000_000);
  });

  it("pays nothing for days before any terms exist", () => {
    const late = [terms({ effectiveFrom: d("2026-09-11") })];
    const result = calculateMonthPay(SEPT, late, days("2026-09-01", "2026-09-30"));
    expect(result.basePaise).toBe(2_000_000);
    expect(result.payableDays).toBe(20);
  });

  it("prorates allowances the same way and keeps them apart from the base", () => {
    const result = calculateMonthPay(SEPT, [terms({ allowancesPaise: 300_000 })], days("2026-09-01", "2026-09-20"));
    expect(result).toMatchObject({ basePaise: 2_000_000, allowancesPaise: 200_000 });
  });

  it("uses the month's own length (31 days in October)", () => {
    const oct = { from: d("2026-10-01"), to: d("2026-10-31") };
    expect(calculateMonthPay(oct, [terms({ baseSalaryPaise: 3_100_000 })], days("2026-10-01", "2026-10-10")).basePaise).toBe(1_000_000);
  });

  it("weekly terms are a seventh a day, per-job terms earn no base", () => {
    expect(calculateMonthPay(SEPT, [terms({ payCycle: "weekly", baseSalaryPaise: 700_000 })], days("2026-09-01", "2026-09-14")).basePaise).toBe(1_400_000);
    expect(calculateMonthPay(SEPT, [terms({ payCycle: "per_job", baseSalaryPaise: 700_000 })], days("2026-09-01", "2026-09-14"))).toMatchObject({ basePaise: 0, payableDays: 14 });
  });

  it("picks the latest terms that have started", () => {
    const versions = [terms(), terms({ effectiveFrom: d("2026-06-01"), baseSalaryPaise: 1 }), terms({ effectiveFrom: d("2026-12-01"), baseSalaryPaise: 2 })];
    expect(termsInForce(versions, d("2026-09-01"))?.baseSalaryPaise).toBe(1);
    expect(termsInForce(versions, d("2025-12-31"))).toBeNull();
  });
});

describe("which days are paid", () => {
  const attendance = (statuses: Record<string, any>) => Object.entries(statuses).map(([date, status]) => ({ date: d(date), status }));

  it("pays present, late, leave and holiday days and not absent ones", () => {
    const { days: out, provisional } = payDaysOf({
      month: SEPT, today: d("2026-10-01"), employeeExited: false, joinDate: d("2026-01-01"),
      attendance: attendance({ "2026-09-01": "present", "2026-09-02": "late", "2026-09-03": "on_leave", "2026-09-04": "off", "2026-09-05": "absent" }),
    });
    expect(out.map((x) => x.payable)).toEqual([true, true, true, true, false]);
    expect(provisional).toBe(false);
  });

  it("does not dock today for not having clocked in yet, and projects the rest of a running month", () => {
    const october = { from: d("2026-10-01"), to: d("2026-10-31") };
    const { days: out, provisional } = payDaysOf({
      month: october, today: d("2026-10-01"), employeeExited: false, joinDate: d("2026-01-01"),
      attendance: attendance({ "2026-10-01": "absent" }),
    });
    expect(out).toHaveLength(31);
    expect(out.every((x) => x.payable)).toBe(true);
    expect(provisional).toBe(true);
  });

  it("does not project days for someone who has left, nor before they joined", () => {
    const october = { from: d("2026-10-01"), to: d("2026-10-31") };
    expect(payDaysOf({ month: october, today: d("2026-10-01"), employeeExited: true, joinDate: d("2026-01-01"), attendance: [] }).days).toHaveLength(0);
    expect(payDaysOf({ month: october, today: d("2026-10-01"), employeeExited: false, joinDate: d("2026-10-20"), attendance: [] }).days).toHaveLength(12);
  });
});

describe("incentive tiers and periods", () => {
  const rules = [
    { thresholdMilli: 20_000, rewardPaise: 50_000 },
    { thresholdMilli: 40_000, rewardPaise: 150_000 },
  ];
  it.each([
    [0, 0],
    [19_999, 0],
    [20_000, 50_000],
    [39_999, 50_000],
    [40_000, 150_000],
    [99_000, 150_000],
  ])("a value of %i milli earns %i paise (the highest tier reached, not the sum)", (value, reward) => expect(rewardFor(rules, value)).toBe(reward));

  it("keys periods and reads them back", () => {
    expect(periodKeyOf("daily", d("2026-09-05"))).toBe("2026-09-05");
    expect(periodKeyOf("monthly", d("2026-09-05"))).toBe("2026-09");
    expect(weekKeyOf(d("2026-10-01"))).toBe("2026-W40");
    expect(weekKeyOf(d("2026-01-01"))).toBe("2026-W01");
    expect(weekKeyOf(d("2027-01-01"))).toBe("2026-W53");
    expect(periodRangeOf("weekly", "2026-W40")).toEqual({ start: d("2026-09-28"), end: d("2026-10-04") });
    expect(periodRangeOf("monthly", "2026-02")).toEqual({ start: d("2026-02-01"), end: d("2026-02-28") });
    expect(periodRangeOf("daily", "2026-09-31")).toBeNull();
    expect(periodRangeOf("weekly", "2026-W54")).toBeNull();
    expect(periodRangeOf("weekly", "2025-W53")).toBeNull();
    expect(periodRangeOf("monthly", "2026-13")).toBeNull();
  });

  it("a payout covers approved earnings oldest first, whole ones only", () => {
    const earnings = [{ rewardPaise: 500 }, { rewardPaise: 300 }, { rewardPaise: 200 }];
    expect(earningsCoveredBy(earnings, 0)).toHaveLength(0);
    expect(earningsCoveredBy(earnings, 499)).toHaveLength(0);
    expect(earningsCoveredBy(earnings, 500)).toHaveLength(1);
    expect(earningsCoveredBy(earnings, 799)).toHaveLength(1);
    expect(earningsCoveredBy(earnings, 1000)).toHaveLength(3);
  });
});

describe("money and quantity parsing", () => {
  it.each([
    [100, 10_000],
    [0.1, 10],
    [12345.67, 1_234_567],
  ])("%d rupees is %d paise", (rupees, paise) => expect(parsePaise(rupees, "x", 1e9)).toBe(paise));

  it.each([[0.001], [-1], ["5"], [Number.NaN], [1e12], [0]])("refuses %p", (value) => expect(() => parsePaise(value, "x", 1e9)).toThrow());
  it("allows zero only when asked", () => expect(parsePaise(0, "x", 1e9, true)).toBe(0));
  it("converts quantities to thousandths and marks to hundredths", () => {
    expect(parseMilli(4.5, "x", 0, 5)).toBe(4500);
    expect(() => parseMilli(4.5001, "x", 0, 5)).toThrow();
    expect(() => parseMilli(6, "x", 0, 5)).toThrow();
    expect(parseScore(87.25, "score")).toBe(8725);
    expect(() => parseScore(100.01, "score")).toThrow();
  });
});

describe("the performance score", () => {
  const inputs = (over: Partial<Parameters<typeof measuresOf>[0]> = {}) => ({
    employeeId: "e", present: 0, late: 0, expectedDays: 0, trainingDue: 0, trainingDone: 0, ratings: [] as number[], ...over,
  });

  it("is null when nothing can be measured", () => {
    expect(scoreOf(measuresOf(inputs()))).toBeNull();
  });

  it.each([
    ["full marks everywhere", inputs({ present: 20, expectedDays: 20, trainingDue: 2, trainingDone: 2, ratings: [5] }), 100],
    ["attendance 19 of 20 (95% meets the target)", inputs({ present: 19, expectedDays: 20 }), 100],
    ["half the days, always on time: attendance 52.6% of target, punctuality 100%", inputs({ present: 10, expectedDays: 20 }), 71.6],
    ["every day attended but half of them late: punctuality 55.6% of target", inputs({ present: 10, late: 10, expectedDays: 20 }), 82.2],
    ["training half done", inputs({ trainingDue: 4, trainingDone: 2 }), 50],
    ["a rating of 2 against the target of 4", inputs({ ratings: [2] }), 50],
    ["the newest rating counts", inputs({ ratings: [4, 1] }), 100],
  ])("%s", (_label, input, expected) => expect(scoreOf(measuresOf(input))).toBe(expected));

  it("weighs the measures (attendance 3, punctuality 2, training 2, appraisal 3)", () => {
    // attendance 100% (w3), punctuality 100% (w2), training 0% (w2): 5000/7 = 71.4
    expect(scoreOf(measuresOf(inputs({ present: 20, expectedDays: 20, trainingDue: 1, trainingDone: 0 })))).toBe(71.4);
  });

  it("caps a measure at its target: working a day off does not push attendance over 100%", () => {
    const [attendance] = measuresOf(inputs({ present: 25, expectedDays: 20 }));
    expect(attendance.actual).toBe(100);
    expect(attendance.attainmentPermille).toBe(1000);
  });

  it("is deterministic for the same inputs", () => {
    const input = inputs({ present: 13, late: 2, expectedDays: 19, trainingDue: 3, trainingDone: 2, ratings: [3] });
    expect(scoreOf(measuresOf(input))).toBe(scoreOf(measuresOf(input)));
  });

  it("reports a trend from the earlier period, moving only beyond 2% of the target", () => {
    expect(trendOf(96, 90, 95)).toBe("up");
    expect(trendOf(90, 96, 95)).toBe("down");
    expect(trendOf(95, 94, 95)).toBe("flat");
    expect(trendOf(95, undefined, 95)).toBe("flat");
    const now = measuresOf(inputs({ present: 20, expectedDays: 20 }));
    const before = measuresOf(inputs({ present: 10, expectedDays: 20 }));
    expect(toMetrics(now, before)[0]).toMatchObject({ name: "Attendance rate (%)", target: 95, actual: 100, trend: "up" });
  });

  it("ranks highest first, shares a rank on a tie and leaves the unmeasured unranked", () => {
    const ranked = rankScores([
      { id: "a", score: 80 }, { id: "b", score: 90 }, { id: "c", score: 80 }, { id: "d", score: null }, { id: "e", score: 70 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([["b", 1], ["a", 2], ["c", 2], ["e", 4], ["d", null]]);
  });
});

describe("training and grievance helpers", () => {
  it("a completion expires validForDays after its business day (IST)", () => {
    // 23:30 UTC on 30 Sept is 05:00 IST on 1 Oct
    expect(expiryOf(new Date("2026-09-30T23:30:00.000Z"), 30)).toEqual(d("2026-10-31"));
    expect(expiryOf(new Date("2026-09-30T23:30:00.000Z"), null)).toBeNull();
  });

  it("derives overdue from the next due date", () => {
    const today = d("2026-10-01");
    expect(derivedStatus({ status: "assigned", nextDueOn: d("2026-09-30") }, today)).toBe("overdue");
    expect(derivedStatus({ status: "assigned", nextDueOn: today }, today)).toBe("assigned");
    expect(derivedStatus({ status: "completed", nextDueOn: null }, today)).toBe("completed");
    expect(derivedStatus({ status: "completed", nextDueOn: d("2026-01-01") }, today)).toBe("overdue");
  });

  it("judges the SLA on the first response and on resolution", () => {
    const base = { firstResponseDueAt: new Date("2026-10-03T00:00:00Z"), resolutionDueAt: new Date("2026-10-15T00:00:00Z"), firstResponseAt: null, closedAt: null };
    expect(slaBreached(base, new Date("2026-10-02T00:00:00Z"))).toBe(false);
    expect(slaBreached(base, new Date("2026-10-04T00:00:00Z"))).toBe(true);
    expect(slaBreached({ ...base, firstResponseAt: new Date("2026-10-02T00:00:00Z") }, new Date("2026-10-10T00:00:00Z"))).toBe(false);
    expect(slaBreached({ ...base, firstResponseAt: new Date("2026-10-02T00:00:00Z") }, new Date("2026-10-16T00:00:00Z"))).toBe(true);
    expect(slaBreached({ ...base, firstResponseAt: new Date("2026-10-02T00:00:00Z"), closedAt: new Date("2026-10-14T00:00:00Z") }, new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});
