const mockFindUnique = jest.fn();
const mockFindMany = jest.fn().mockResolvedValue([]);
jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: { store: { findUnique: (...a: unknown[]) => mockFindUnique(...a), findMany: (...a: unknown[]) => mockFindMany(...a) } } }));

import { StoreQuery } from "./Store.Query.js";

const OWN = "11111111-1111-4111-8111-111111111101";
const OTHER = "11111111-1111-4111-8111-111111111102";

// Regression: a scope spread over { id } used to overwrite the requested id, so a manager asking
// for another store was handed their own. Found by the live run, invisible to the in-memory fake.
describe("StoreQuery scoping", () => {
  it("does not look up a store other than the caller's", async () => {
    expect(await StoreQuery.findById(OTHER, OWN)).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("looks up the requested store for the caller's own id, and for an unscoped admin", async () => {
    mockFindUnique.mockResolvedValue({ id: OTHER });
    await StoreQuery.findById(OWN, OWN);
    await StoreQuery.findById(OTHER, null);
    expect(mockFindUnique.mock.calls.map(([arg]) => arg.where.id)).toEqual([OWN, OTHER]);
  });

  it("lists only the scoped store", async () => {
    await StoreQuery.list(OWN);
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ id: OWN });
  });
});
