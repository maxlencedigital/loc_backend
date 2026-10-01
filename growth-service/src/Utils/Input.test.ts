import { dateField, intField, onlyKeys, pathId, queryBool, queryInt, toPaise, toRupees, uuidList } from "./Input.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("Input", () => {
  it("converts rupees to whole paise and back without float drift", () => {
    expect(toPaise(19.99, "x")).toBe(1999);
    expect(toPaise(0.1 + 0.2, "x")).toBe(30);
    expect(toRupees(1999)).toBe(19.99);
  });

  it.each([[-1], ["5"], [Number.NaN], [Infinity], [30_000_000]])("rejects money %p", (value) => {
    expect(() => toPaise(value, "x")).toThrow(expect.objectContaining({ errorCode: 400 }));
  });

  it("can forbid zero", () => {
    expect(() => toPaise(0, "x", false)).toThrow();
    expect(toPaise(0, "x")).toBe(0);
  });

  it("answers 404, not 400, for a path id that is not a uuid", () => {
    expect(pathId(ID.toUpperCase())).toBe(ID);
    expect(() => pathId("1; drop table")).toThrow(expect.objectContaining({ errorCode: 404 }));
  });

  it("reads a bare date as start of day, or end of day when asked", () => {
    expect(dateField("2026-03-01", "d").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(dateField("2026-03-01", "d", true).toISOString()).toBe("2026-03-01T23:59:59.999Z");
    expect(() => dateField("soon", "d")).toThrow();
  });

  it("checks integers, id lists, whitelists and query values", () => {
    expect(() => intField(1.5, "n", 0, 10)).toThrow();
    expect(() => intField(11, "n", 0, 10)).toThrow();
    expect(uuidList([ID, ID], "ids", 5)).toEqual([ID]);
    expect(() => uuidList([ID, ID, ID], "ids", 2)).toThrow();
    expect(() => uuidList(["x"], "ids", 5)).toThrow();
    expect(() => onlyKeys({ a: 1, evil: 2 }, ["a"])).toThrow(/evil/);
    expect(queryBool("true", "f")).toBe(true);
    expect(queryBool(undefined, "f")).toBeUndefined();
    expect(() => queryBool("1", "f")).toThrow();
    expect(queryInt("7", "n", 1, 10, 3)).toBe(7);
    expect(queryInt(undefined, "n", 1, 10, 3)).toBe(3);
    expect(() => queryInt("99", "n", 1, 10, 3)).toThrow();
  });
});
