import { chargeableByYear, countLeaveDays, dayStatus, holidayApplies } from "../Services/HrCalendar.js";
import { decryptField, encryptField, resetFieldCipher } from "./FieldCipher.js";
import { businessToday, dayStart, formatTime, minutesOfDay, parseDate, parseMonth, parseRange, parseTime } from "./HrDate.js";
import { normaliseKey, parsePhone } from "./HrInput.js";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const holiday = (date: string, type: "public" | "company" | "store" = "public", storeIds: string[] = []) => ({
  id: date,
  date: d(date),
  name: date,
  type,
  storeIds,
});

describe("dates in the business time zone", () => {
  it("rolls the business day over at 18:30 UTC, which is midnight in IST", () => {
    expect(businessToday(new Date("2026-09-30T18:29:59.000Z")).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(businessToday(new Date("2026-09-30T18:30:00.000Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("converts between a business day, its start instant and minutes of the day", () => {
    expect(dayStart(d("2026-10-01")).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(minutesOfDay(new Date("2026-10-01T05:00:00.000Z"))).toBe(10 * 60 + 30);
  });

  it("parses strict dates, months and times", () => {
    expect(parseDate("2026-02-28", "d").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    for (const bad of ["2026-02-30", "2026-2-3", "tomorrow", 20260101, null]) expect(() => parseDate(bad, "d")).toThrow(/must be a date/);
    expect(parseMonth("2026-02", "month")).toEqual({ from: d("2026-02-01"), to: d("2026-02-28") });
    expect(() => parseMonth("2026-00", "month")).toThrow(/month must be/);
    expect(parseTime("09:05", "t")).toBe(545);
    expect(formatTime(545)).toBe("09:05");
    expect(() => parseTime("24:00", "t")).toThrow(/time like/);
  });

  it("bounds a range", () => {
    const fallback = { from: d("2026-10-01"), to: d("2026-10-01") };
    expect(parseRange("2026-10-01", "2026-10-10", fallback, 31)).toEqual({ from: d("2026-10-01"), to: d("2026-10-10") });
    expect(() => parseRange("2026-10-01", "2026-12-31", fallback, 31)).toThrow(/at most 31 days/);
    expect(() => parseRange("2026-10-10", "2026-10-01", fallback, 31)).toThrow(/must not be after/);
  });
});

describe("phone numbers and keys", () => {
  it.each([
    ["9845012345", "+919845012345"],
    ["+91 98450 12345", "+919845012345"],
    ["098450 12345", "+919845012345"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("writes %s as %s", (input, expected) => {
    expect(parsePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "5845012345", "+91", "abc", 9845012345])("refuses %p", (input) => {
    expect(() => parsePhone(input)).toThrow(/phone must be/);
  });

  it("makes role and blocker keys comparable", () => {
    expect(normaliseKey("  Senior   Washer! ")).toBe("senior washer");
    expect(normaliseKey("Washer #2 BROKEN.")).toBe(normaliseKey("washer 2 broken"));
  });
});

describe("the field cipher", () => {
  beforeAll(() => {
    process.env.IS_LOCAL = "true";
    resetFieldCipher();
  });

  it("round-trips, uses a fresh IV each time and never contains the plain text", () => {
    const a = encryptField("123456789012");
    const b = encryptField("123456789012");
    expect(a).not.toBe(b);
    expect(a).not.toContain("123456789012");
    expect(decryptField(a)).toBe("123456789012");
  });

  it("detects tampering and unknown formats", () => {
    const parts = encryptField("secret").split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
    expect(() => decryptField("v2:a:b:c")).toThrow(/Unrecognised/);
  });

  it("accepts a configured 32-byte key and refuses one of the wrong size", () => {
    process.env.HR_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
    resetFieldCipher();
    expect(decryptField(encryptField("x"))).toBe("x");
    process.env.HR_DATA_KEY = Buffer.alloc(8).toString("base64");
    resetFieldCipher();
    expect(() => encryptField("x")).toThrow(/cannot be stored/);
    delete process.env.HR_DATA_KEY;
    resetFieldCipher();
  });
});

describe("leave arithmetic", () => {
  it("charges two half-days a day, skips holidays and splits at the year end", () => {
    const span = { fromDate: d("2026-12-30"), toDate: d("2027-01-02"), halfDay: false };
    expect([...chargeableByYear(span, [], null)]).toEqual([[2026, 4], [2027, 4]]);
    expect([...chargeableByYear(span, [holiday("2027-01-01")], null)]).toEqual([[2026, 4], [2027, 2]]);
    expect([...chargeableByYear({ ...span, toDate: d("2026-12-30"), halfDay: true }, [], null)]).toEqual([[2026, 1]]);
  });

  it("applies a store holiday only to that store", () => {
    const store = holiday("2026-10-06", "store", ["s1"]);
    expect(holidayApplies(store, "s1")).toBe(true);
    expect(holidayApplies(store, "s2")).toBe(false);
    expect(holidayApplies(store, null)).toBe(false);
    expect(holidayApplies(holiday("2026-10-06", "company"), null)).toBe(true);
  });

  it("counts each leave date once even when requests overlap, and skips holidays", () => {
    const spans = [
      { fromDate: d("2026-10-01"), toDate: d("2026-10-05"), halfDay: false },
      { fromDate: d("2026-10-04"), toDate: d("2026-10-08"), halfDay: false },
    ];
    expect(countLeaveDays(spans, d("2026-10-03"), d("2026-10-10"), [holiday("2026-10-06")], null)).toBe(5);
  });

  it("ranks a day: a record, then leave, then a holiday, else absent", () => {
    const spans = [{ fromDate: d("2026-10-05"), toDate: d("2026-10-05"), halfDay: false }];
    const record = { id: "r", employeeId: "e", storeId: null, date: d("2026-10-05"), status: "late" as const, clockIn: null, clockOut: null, corrected: false };
    const holidays = [holiday("2026-10-05")];
    expect(dayStatus(record, spans, holidays, d("2026-10-05"), null)).toBe("late");
    expect(dayStatus(undefined, spans, holidays, d("2026-10-05"), null)).toBe("on_leave");
    expect(dayStatus(undefined, [], holidays, d("2026-10-05"), null)).toBe("off");
    expect(dayStatus(undefined, [], [], d("2026-10-05"), null)).toBe("absent");
  });
});
