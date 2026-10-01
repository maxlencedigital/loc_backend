import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, UserRole } from "./Identity.js";
import { NO_STORE_MESSAGE, requestActor, resolveStoreScope } from "./StoreScope.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";

// The gateway's headers, as Express would hand them over.
const requestFor = (role: UserRole, headers: Record<string, string> = {}): IdentifiedRequest =>
  ({
    user: { id: "u1", role },
    header: (name: string) => headers[name.toLowerCase()],
  }) as unknown as IdentifiedRequest;

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
      expect(resolveStoreScope(requestFor(role, { "x-store-scope": STORE_B }))).toBe(STORE_B);
    });

    it("keeps the wider view even when assigned to a store", () => {
      expect(resolveStoreScope(requestFor(role, { "x-user-store-id": STORE_A }))).toBeNull();
    });

    it("rejects a scope that is not a store id", () => {
      expect(refusal(requestFor(role, { "x-store-scope": "all" })).errorCode).toBe(400);
    });
  });

  describe.each<UserRole>(["manager", "staff"])("%s", (role) => {
    it("is pinned to their own store", () => {
      expect(resolveStoreScope(requestFor(role, { "x-user-store-id": STORE_A }))).toBe(STORE_A);
    });

    it("ignores a forged scope header for another store", () => {
      expect(resolveStoreScope(requestFor(role, { "x-user-store-id": STORE_A, "x-store-scope": STORE_B }))).toBe(STORE_A);
    });

    it("ignores a forged scope header even without a store of their own", () => {
      const error = refusal(requestFor(role, { "x-store-scope": STORE_B }));
      expect(error.errorCode).toBe(403);
      expect(error.displayMessage).toBe(NO_STORE_MESSAGE);
    });

    it("is refused with 403 when not assigned to a store", () => {
      expect(refusal(requestFor(role)).errorCode).toBe(403);
    });

    it("is refused when the token carries a malformed store id", () => {
      expect(refusal(requestFor(role, { "x-user-store-id": "not-a-uuid" })).errorCode).toBe(403);
    });
  });

  it("lets hr see every store, whatever store or scope header it carries", () => {
    expect(resolveStoreScope(requestFor("hr"))).toBeNull();
    expect(resolveStoreScope(requestFor("hr", { "x-user-store-id": STORE_A, "x-store-scope": STORE_B }))).toBeNull();
  });

  it.each<UserRole>(["driver", "customer"])("refuses the %s role outright", (role) => {
    expect(refusal(requestFor(role, { "x-user-store-id": STORE_A })).errorCode).toBe(403);
  });

  it("answers 401 without an identity", () => {
    expect(refusal({ header: () => undefined } as unknown as IdentifiedRequest).errorCode).toBe(401);
  });
});

describe("requestActor", () => {
  it("decodes the percent-encoded name and drops a malformed one", () => {
    expect(requestActor(requestFor("manager", { "x-user-name": "Meera%20Nair" })).name).toBe("Meera Nair");
    expect(requestActor(requestFor("manager", { "x-user-name": "%E0%A4%A" })).name).toBeNull();
  });
});
