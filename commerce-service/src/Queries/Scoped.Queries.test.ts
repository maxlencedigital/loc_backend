const mockOrderFindFirst = jest.fn().mockResolvedValue(null);
const mockOrderUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
const mockOrderFindMany = jest.fn().mockResolvedValue([]);
const mockOrderGroupBy = jest.fn().mockResolvedValue([]);
const mockCustomerFindFirst = jest.fn().mockResolvedValue(null);
const mockCustomerFindMany = jest.fn().mockResolvedValue([]);

jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: {
    order: {
      findFirst: (...a: unknown[]) => mockOrderFindFirst(...a),
      updateMany: (...a: unknown[]) => mockOrderUpdateMany(...a),
      findMany: (...a: unknown[]) => mockOrderFindMany(...a),
      groupBy: (...a: unknown[]) => mockOrderGroupBy(...a),
    },
    customer: { findFirst: (...a: unknown[]) => mockCustomerFindFirst(...a), findMany: (...a: unknown[]) => mockCustomerFindMany(...a) },
  },
}));

import { CustomerQuery } from "./Customer.Query.js";
import { OrderQuery } from "./Order.Query.js";

const STORE = "11111111-1111-4111-8111-111111111101";
const ID = "22222222-2222-4222-8222-222222222222";

// The store scope must reach the WHERE clause of every read and lock, or cross-store access
// would only be prevented by the service layer.
describe("store scope reaches the database query", () => {
  it("scopes order lookup, the row lock, the list and the pipeline counts", async () => {
    await OrderQuery.findById(ID, STORE);
    await OrderQuery.lockById(ID, STORE, { order: { updateMany: mockOrderUpdateMany } } as never);
    await OrderQuery.search({ storeId: STORE, limit: 5 });
    await OrderQuery.countByStatus(STORE, ["booked"]);

    expect(mockOrderFindFirst.mock.calls[0][0].where).toEqual({ id: ID, storeId: STORE });
    expect(mockOrderUpdateMany.mock.calls[0][0].where).toEqual({ id: ID, storeId: STORE });
    expect(mockOrderFindMany.mock.calls[0][0].where).toMatchObject({ storeId: STORE });
    expect(mockOrderGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: STORE });
  });

  it("leaves the store out for an unscoped admin", async () => {
    await OrderQuery.findById(ID, null);
    expect(mockOrderFindFirst.mock.calls.at(-1)?.[0].where).toEqual({ id: ID });
  });

  it("scopes customer lookup and search", async () => {
    await CustomerQuery.findById(ID, STORE);
    await CustomerQuery.search({ storeId: STORE, limit: 5 });

    expect(mockCustomerFindFirst.mock.calls[0][0].where).toEqual({ id: ID, storeId: STORE });
    expect(mockCustomerFindMany.mock.calls[0][0].where).toMatchObject({ storeId: STORE });
  });
});
