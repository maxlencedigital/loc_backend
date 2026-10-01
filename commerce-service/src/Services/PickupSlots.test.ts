import {
  buildWindows,
  dayStart,
  isBookableAt,
  istDateOf,
  parseDateOnly,
  parseOpeningHours,
} from "./PickupSlots.js";
import { decideExpress } from "./PickupSlot.Service.js";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/PickupSlot.Query.js", () => ({ PickupSlotQuery: {} }));
jest.mock("../Queries/CustomerOrder.Query.js", () => ({ CustomerOrderQuery: {} }));

describe("opening hours", () => {
  it.each([
    ["07:00 – 21:00", { openMinute: 420, closeMinute: 1260 }],
    ["08:30-20:00", { openMinute: 510, closeMinute: 1200 }],
    ["7:00 — 9:15", { openMinute: 420, closeMinute: 555 }],
  ])("reads %s", (text, expected) => expect(parseOpeningHours(text)).toEqual(expected));

  it.each(["07:00", "closed", "21:00 – 07:00", "07:00 – 25:00", "07:61 – 21:00", ""])(
    "refuses %p, so the store has no slots rather than invented ones",
    (text) => expect(parseOpeningHours(text)).toBeNull()
  );
});

describe("slot windows", () => {
  const hours = { openMinute: 420, closeMinute: 1260 }; // 07:00 to 21:00

  it("fills the day back to back from opening, in Indian time", () => {
    const windows = buildWindows("2026-10-06", hours, 120);
    expect(windows).toHaveLength(7);
    // 07:00 IST is 01:30 UTC.
    expect(windows[0]!.startsAt.toISOString()).toBe("2026-10-06T01:30:00.000Z");
    expect(windows[0]!.endsAt.toISOString()).toBe("2026-10-06T03:30:00.000Z");
    expect(windows[6]!.endsAt.toISOString()).toBe("2026-10-06T15:30:00.000Z"); // 21:00 IST
  });

  it("never lets the last window run past closing", () => {
    const windows = buildWindows("2026-10-06", { openMinute: 420, closeMinute: 600 }, 120);
    expect(windows).toHaveLength(1);
    expect(buildWindows("2026-10-06", { openMinute: 420, closeMinute: 500 }, 120)).toEqual([]);
  });

  it("maps instants to the Indian calendar day and back", () => {
    expect(istDateOf(new Date("2026-10-05T19:00:00Z"))).toBe("2026-10-06"); // 00:30 IST next day
    expect(istDateOf(new Date("2026-10-05T18:29:59Z"))).toBe("2026-10-05");
    expect(dayStart("2026-10-06").toISOString()).toBe("2026-10-05T18:30:00.000Z");
  });

  it("opens a window for booking only from its lead time", () => {
    const start = new Date("2026-10-06T04:00:00Z");
    expect(isBookableAt(start, new Date("2026-10-06T02:00:00Z"), 120)).toBe(true);
    expect(isBookableAt(start, new Date("2026-10-06T02:00:01Z"), 120)).toBe(false);
  });
});

describe("date input", () => {
  it("accepts a real calendar date", () => expect(parseDateOnly("2026-10-06", "date")).toBe("2026-10-06"));

  it.each(["2026-02-30", "06-10-2026", "2026-10-6", "tomorrow", "", 5, null, undefined])("refuses %p with 400", (value) => {
    expect(() => parseDateOnly(value, "date")).toThrow(expect.objectContaining({ errorCode: 400 }));
  });
});

describe("the express rule", () => {
  const base = { storeLive: true, capacityKgPerDay: 100, openGrams: 0, basketGrams: 0 };

  it("is available while open load plus the basket stays within 80% of daily capacity", () => {
    expect(decideExpress({ ...base, openGrams: 70_000, basketGrams: 10_000 })).toMatchObject({ available: true, reasons: [] });
  });

  it("is off the moment the plant would pass 80%", () => {
    const decision = decideExpress({ ...base, openGrams: 70_000, basketGrams: 10_001 });
    expect(decision.available).toBe(false);
    expect(decision.constraints.machine).toBe(false);
    expect(decision.reasons[0]).toMatch(/full for today/);
  });

  it("is off for a store that is not live, and says staff and rider cover were not assessed", () => {
    const decision = decideExpress({ ...base, storeLive: false });
    expect(decision.available).toBe(false);
    expect(decision.constraints).toEqual({ machine: true, staff: null, rider: null });
  });
});
