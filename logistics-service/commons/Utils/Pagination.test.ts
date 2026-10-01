import { CustomException } from "../Exception/CustomException.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePage, toPage } from "./Pagination.js";

describe("parsePage", () => {
  it("defaults to the first page of 20", () => {
    expect(parsePage({})).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(parsePage()).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });

  it("reads string query values and computes the offset", () => {
    expect(parsePage({ page: "3", limit: "25" })).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  it("lowers an oversized limit to the cap instead of refusing it", () => {
    expect(parsePage({ limit: "100000" }).limit).toBe(MAX_PAGE_SIZE);
  });

  it.each([["0"], ["-1"], ["1.5"], ["abc"], [{}], [[1]]])("refuses page %p", (page) => {
    expect(() => parsePage({ page })).toThrow(CustomException);
  });

  it.each([["0"], ["-5"], ["x"]])("refuses limit %p", (limit) => {
    expect(() => parsePage({ limit })).toThrow(CustomException);
  });
});

describe("toPage", () => {
  it("wraps rows with the paging fields", () => {
    expect(toPage([{ a: 1 }], 41, { page: 2, limit: 20, offset: 20 })).toEqual({
      items: [{ a: 1 }],
      page: 2,
      limit: 20,
      total: 41,
    });
  });
});
