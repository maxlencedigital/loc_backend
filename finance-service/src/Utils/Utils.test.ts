import { CustomException } from "../../commons/Exception/CustomException.js";
import { parseBankCsv } from "./BankCsv.js";
import { addDays, dayRange, istDayEnd, istDayStart, istToday, monthEnd, nextMonth, parseDay, parseMonth } from "./Dates.js";
import { idempotencyKeyOf, isUuid, pathId, queryString, wholeNumber } from "./Input.js";
import { mulDivHalfUp, rupeesToPaise, toRupees, wholePaise } from "./Money.js";
import { parseMultipart } from "./Multipart.js";

const status = (fn: () => unknown): number => {
  try {
    fn();
  } catch (error) {
    return (error as CustomException).errorCode;
  }
  throw new Error("expected a refusal");
};

describe("Money", () => {
  it("converts rupees to whole paise without float noise", () => {
    expect(rupeesToPaise(499.5, "amount")).toBe(49950);
    expect(rupeesToPaise(0.1 + 0.2, "amount")).toBe(30);
    expect(rupeesToPaise("1234.5", "amount")).toBe(123450);
    expect(rupeesToPaise(19.99, "amount")).toBe(1999);
  });

  it("refuses a third decimal, zero, negatives, junk and huge values instead of rounding", () => {
    for (const bad of [1.005, 0, -5, "abc", NaN, Infinity, null, undefined, "1.234", 25_000_000.01]) {
      expect(status(() => rupeesToPaise(bad, "amount"))).toBe(400);
    }
    expect(rupeesToPaise(0, "amount", { allowZero: true })).toBe(0);
  });

  it("takes paise only as whole numbers inside bounds", () => {
    expect(wholePaise(100, "x")).toBe(100);
    for (const bad of [1.5, "100", -1, 0, 3_000_000_000]) expect(status(() => wholePaise(bad, "x"))).toBe(400);
  });

  it("round-half-up: 0.5 paise rounds up, 0.49 down, and big products stay exact", () => {
    expect(mulDivHalfUp(1, 1, 2)).toBe(1);
    expect(mulDivHalfUp(49, 1, 100)).toBe(0);
    expect(mulDivHalfUp(50, 1, 100)).toBe(1);
    // 9e12 * 10000 overflows a 53-bit float product; BigInt keeps it exact.
    expect(mulDivHalfUp(9_000_000_000_001, 10_000, 11_800)).toBe(7_627_118_644_069);
    expect(toRupees(7_627_118_644_069)).toBe(76_271_186_440.69);
  });
});

describe("Dates (IST)", () => {
  it("refuses impossible dates rather than rolling them over", () => {
    expect(parseDay("2026-02-28", "d")).toBe("2026-02-28");
    for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "", 5, undefined]) expect(status(() => parseDay(bad, "d"))).toBe(400);
  });

  it("reads 'today' in IST: 20:00 UTC is already tomorrow in India", () => {
    expect(istToday(new Date("2026-10-01T20:00:00Z"))).toBe("2026-10-02");
    expect(istToday(new Date("2026-10-01T18:29:00Z"))).toBe("2026-10-01");
  });

  it("bounds a day by IST midnights", () => {
    expect(istDayStart("2026-10-02").toISOString()).toBe("2026-10-01T18:30:00.000Z");
    expect(istDayEnd("2026-10-02").toISOString()).toBe("2026-10-02T18:30:00.000Z");
  });

  it("does month arithmetic across year ends and leap years", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(status(() => parseMonth("2026-13", "m"))).toBe(400);
  });

  it("bounds ranges: reversed and over-long windows are refused", () => {
    expect(dayRange({ from: "2026-01-01", to: "2026-01-31" }, { defaultDays: 30, maxDays: 366 })).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(status(() => dayRange({ from: "2026-02-01", to: "2026-01-01" }, { defaultDays: 30, maxDays: 366 }))).toBe(400);
    expect(status(() => dayRange({ from: "2025-01-01", to: "2026-06-01" }, { defaultDays: 30, maxDays: 366 }))).toBe(400);
    expect(dayRange({ to: "2026-03-30" }, { defaultDays: 30, maxDays: 366 }).from).toBe("2026-03-01");
  });
});

describe("Input", () => {
  it("answers 404 for a malformed path id and refuses repeated query values", () => {
    expect(status(() => pathId("not-a-uuid"))).toBe(404);
    expect(pathId("AAAAAAAA-1111-4111-8111-111111111101")).toBe("aaaaaaaa-1111-4111-8111-111111111101");
    expect(status(() => queryString(["a", "b"], "q"))).toBe(400);
    expect(isUuid("x")).toBe(false);
  });

  it("validates idempotency keys and whole numbers", () => {
    expect(idempotencyKeyOf("abc-123")).toBe("abc-123");
    expect(idempotencyKeyOf(undefined)).toBeUndefined();
    expect(status(() => idempotencyKeyOf("has space"))).toBe(400);
    expect(status(() => idempotencyKeyOf("x".repeat(129)))).toBe(400);
    expect(status(() => wholeNumber(1.5, "n", 0, 10))).toBe(400);
  });
});

describe("parseMultipart", () => {
  const boundary = "XBOUNDARYX";
  const build = (parts: string[]) => Buffer.from(parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") + `--${boundary}--\r\n`);
  const type = `multipart/form-data; boundary=${boundary}`;

  it("reads fields and a file with its bytes intact", () => {
    const body = build([
      'Content-Disposition: form-data; name="bank"\r\n\r\nHDFC',
      'Content-Disposition: form-data; name="file"; filename="C:\\evil\\..\\stmt.csv"\r\nContent-Type: text/csv\r\n\r\na,b\r\n1,2',
    ]);
    const parsed = parseMultipart(body, type);
    expect(parsed.fields.bank).toBe("HDFC");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]).toMatchObject({ field: "file", fileName: "stmt.csv", contentType: "text/csv" });
    expect(parsed.files[0]?.content.toString()).toBe("a,b\r\n1,2");
  });

  it("refuses a non-multipart type, a missing boundary and a truncated body", () => {
    expect(status(() => parseMultipart(Buffer.from("{}"), "application/json"))).toBe(400);
    expect(status(() => parseMultipart(Buffer.from("x"), "multipart/form-data"))).toBe(400);
    expect(status(() => parseMultipart(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nno end`), type))).toBe(400);
  });
});

describe("parseBankCsv", () => {
  it("reads debit/credit and amount layouts and both date styles", () => {
    const lines = parseBankCsv(
      'date,description,reference,debit,credit\n2026-10-01,"UPI, order A",pay_1,,"1,250.50"\n02/10/2026,Charges,,10.00,\n',
      "HDFC"
    );
    expect(lines.map((l) => [l.date, l.amountPaise, l.reference])).toEqual([
      ["2026-10-01", 125050, "pay_1"],
      ["2026-10-02", -1000, null],
    ]);
    expect(parseBankCsv("date,description,amount\n2026-10-01,x,-5.5\n", null)[0]?.amountPaise).toBe(-550);
  });

  it("rejects the whole file naming the bad line, and refuses missing columns", () => {
    expect(() => parseBankCsv("date,description,amount\n2026-10-01,x,1.00\n2026-13-45,y,2.00\n", null)).toThrow(/Line 3/);
    expect(() => parseBankCsv("date,description,amount\n2026-10-01,x,1.234\n", null)).toThrow(/Line 2/);
    expect(() => parseBankCsv("when,what\n1,2\n", null)).toThrow(/columns/);
    expect(() => parseBankCsv("date,description,amount\n", null)).toThrow(/no lines/);
  });

  it("gives identical lines on one day different hashes, and the same file the same hashes", () => {
    const csv = "date,description,amount\n2026-10-01,Deposit,100.00\n2026-10-01,Deposit,100.00\n";
    const first = parseBankCsv(csv, "HDFC");
    expect(first[0]?.lineHash).not.toBe(first[1]?.lineHash);
    expect(parseBankCsv(csv, "HDFC").map((l) => l.lineHash)).toEqual(first.map((l) => l.lineHash));
    expect(parseBankCsv(csv, "ICICI")[0]?.lineHash).not.toBe(first[0]?.lineHash);
  });
});
