import { CustomException } from "../../commons/Exception/CustomException.js";
import { IdentifiedRequest, RequestUser, UserRole } from "./Identity.js";
import { NO_STORE_MESSAGE, resolveStoreScope } from "./StoreScope.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";

const requestFor = (role: UserRole, overrides: Partial<RequestUser> = {}): IdentifiedRequest =>
  ({ user: { id: "u1", role, storeId: null, scopeStoreId: null, name: null, ...overrides } }) as IdentifiedRequest;

const refusal = (req: IdentifiedRequest): CustomException => {
  try {
    resolveStoreScope(req);
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected resolveStoreScope to throw");
};

describe("resolveStoreScope", () => {
  describe.each<UserRole>(["super_admin", "admin"])("%s", (role) => {
    it("sees every store without a scope header", () => {
      expect(resolveStoreScope(requestFor(role))).toBeNull();
    });

    it("is narrowed to the scope header", () => {
      expect(resolveStoreScope(requestFor(role, { scopeStoreId: STORE_B }))).toBe(STORE_B);
    });

    it("keeps the wider view even when assigned to a store", () => {
      expect(resolveStoreScope(requestFor(role, { storeId: STORE_A }))).toBeNull();
    });

    it("rejects a scope that is not a store id", () => {
      const error = refusal(requestFor(role, { scopeStoreId: "all" }));
      expect(error.errorCode).toBe(400);
    });
  });

  describe.each<UserRole>(["manager", "staff"])("%s", (role) => {
    it("is pinned to their own store", () => {
      expect(resolveStoreScope(requestFor(role, { storeId: STORE_A }))).toBe(STORE_A);
    });

    it("ignores a forged scope header for another store", () => {
      expect(resolveStoreScope(requestFor(role, { storeId: STORE_A, scopeStoreId: STORE_B }))).toBe(STORE_A);
    });

    it("ignores a forged scope header even without a store of their own", () => {
      const error = refusal(requestFor(role, { scopeStoreId: STORE_B }));
      expect(error.errorCode).toBe(403);
      expect(error.displayMessage).toBe(NO_STORE_MESSAGE);
    });

    it("is refused with 403 when not assigned to a store", () => {
      const error = refusal(requestFor(role));
      expect(error.errorCode).toBe(403);
      expect(error.displayMessage).toBe("Your account is not assigned to a store.");
    });

    it("is refused when the token carries a malformed store id", () => {
      expect(refusal(requestFor(role, { storeId: "not-a-uuid" })).errorCode).toBe(403);
    });
  });

  it("lets hr see every store, whatever store or scope header it carries", () => {
    expect(resolveStoreScope(requestFor("hr"))).toBeNull();
    expect(resolveStoreScope(requestFor("hr", { storeId: STORE_A, scopeStoreId: STORE_B }))).toBeNull();
  });

  it.each<UserRole>(["driver", "customer"])("refuses the %s role outright", (role) => {
    expect(refusal(requestFor(role, { storeId: STORE_A })).errorCode).toBe(403);
  });

  it("answers 401 without an identity", () => {
    expect(refusal({} as IdentifiedRequest).errorCode).toBe(401);
  });
});
