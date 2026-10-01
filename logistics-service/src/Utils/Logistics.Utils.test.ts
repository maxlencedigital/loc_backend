import { CustomException } from "../../commons/Exception/CustomException.js";
import { dayRange, istDateOf, parseDate, rangeFromQuery } from "./Dates.js";
import { haversineKm, rupeesToPaise } from "./Geo.js";
import { coordinates, httpsUrl, integer, mask, phone } from "./Input.js";

const bad = (fn: () => unknown): CustomException => {
  try {
    fn();
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

describe("Indian calendar days", () => {
  it("a day runs from midnight IST, not midnight UTC", () => {
    const { from, to } = dayRange("2026-10-01");
    expect(from.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-10-01T18:30:00.000Z");
  });

  it("names the Indian date of an instant", () => {
    expect(istDateOf(new Date("2026-09-30T19:00:00Z"))).toBe("2026-10-01");
    expect(istDateOf(new Date("2026-10-01T18:29:00Z"))).toBe("2026-10-01");
  });

  it.each(["2026-02-30", "2026-13-01", "01-10-2026", "tomorrow", ""])("refuses the date %p", (value) => {
    expect(bad(() => parseDate(value, "date")).errorCode).toBe(400);
  });

  it("bounds a from/to range", () => {
    expect(bad(() => rangeFromQuery({ from: "2026-01-01", to: "2026-12-31" }, { defaultDays: 7, maxDays: 92 })).errorCode).toBe(400);
    expect(bad(() => rangeFromQuery({ from: "2026-10-05", to: "2026-10-01" }, { defaultDays: 7, maxDays: 92 })).errorCode).toBe(400);
    const week = rangeFromQuery({}, { defaultDays: 7, maxDays: 92 }, new Date("2026-10-08T06:00:00Z"));
    expect((week.to.getTime() - week.from.getTime()) / 86_400_000).toBe(7);
  });
});

describe("input readers", () => {
  it("normalises Indian mobiles to E.164 and refuses nonsense", () => {
    expect(phone("98450 12345")).toBe("+919845012345");
    expect(phone("+91-98450-12345")).toBe("+919845012345");
    expect(phone("09845012345")).toBe("+919845012345");
    expect(bad(() => phone("12345")).errorCode).toBe(400);
    expect(bad(() => phone(9845012345)).errorCode).toBe(400);
  });

  it("keeps only the last four characters of an identifier", () => {
    expect(mask("1234 5678 9012")).toBe("XXXXXXXX9012");
    expect(mask("AB12")).toBe("AB12");
  });

  it("accepts only https links", () => {
    expect(httpsUrl("https://files.example.com/a.jpg", "u")).toBe("https://files.example.com/a.jpg");
    for (const value of ["http://x.com/a", "javascript:alert(1)", "data:text/plain;base64,AA==", "not a url"]) {
      expect(bad(() => httpsUrl(value, "u")).errorCode).toBe(400);
    }
  });

  it("wants both coordinates or neither, in range", () => {
    expect(coordinates({})).toBeNull();
    expect(coordinates({ latitude: 12.9, longitude: 77.6 })).toEqual({ latitude: 12.9, longitude: 77.6 });
    expect(bad(() => coordinates({ latitude: 12.9 })).errorCode).toBe(400);
    expect(bad(() => coordinates({ latitude: 91, longitude: 0 })).errorCode).toBe(400);
  });

  it("refuses fractions and out-of-range numbers for whole-number fields", () => {
    expect(integer("3", "n", 1, 5)).toBe(3);
    expect(bad(() => integer(2.5, "n", 1, 5)).errorCode).toBe(400);
    expect(bad(() => integer(6, "n", 1, 5)).errorCode).toBe(400);
  });
});

describe("money and distance", () => {
  it("turns rupees into whole paise without floating-point leakage", () => {
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise(499.5)).toBe(49950);
  });

  it("measures a known distance", () => {
    // Bengaluru MG Road to Koramangala is roughly 5 km as the crow flies.
    const km = haversineKm({ latitude: 12.9757, longitude: 77.6011 }, { latitude: 12.9352, longitude: 77.6245 });
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(6);
  });
});
