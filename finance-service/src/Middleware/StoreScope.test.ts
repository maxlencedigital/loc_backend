import { CustomException } from "../../commons/Exception/CustomException.js";
import { IdentifiedRequest, UserRole } from "./Identity.js";
import { NO_STORE_MESSAGE, actorOf, effectiveStore, resolveStoreScope } from "./StoreScope.js";

const STORE_A = "11111111-1111-4111-8111-111111111101";
const STORE_B = "11111111-1111-4111-8111-111111111102";

// A request as the gateway delivers it: identity attached by requireIdentity, store headers raw.
const requestFor = (role: UserRole, headers: Record<string, string> = {}): IdentifiedRequest =>
  ({
    user: { id: "u1", role },
    header: (name: string) => headers[name.toLowerCase()],
  }) as unknown as IdentifiedRequest;

const refusal = (fn: () => unknown): CustomException => {
  try {
    fn();
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a refusal");
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
      expect(refusal(() => resolveStoreScope(requestFor(role, { "x-store-scope": "all" }))).errorCode).toBe(400);
    });
  });

  describe.each<UserRole>(["manager", "staff"])("%s", (role) => {
    it("is pinned to their own store", () => {
      expect(resolveStoreScope(requestFor(role, { "x-user-store-id": STORE_A }))).toBe(STORE_A);
    });
    it("ignores a forged scope header for another store", () => {
      expect(resolveStoreScope(requestFor(role, { "x-user-store-id": STORE_A, "x-store-scope": STORE_B }))).toBe(STORE_A);
    });
    it("is refused with 403 when not assigned to a store, scope header or not", () => {
      const error = refusal(() => resolveStoreScope(requestFor(role, { "x-store-scope": STORE_B })));
      expect(error.errorCode).toBe(403);
      expect(error.displayMessage).toBe(NO_STORE_MESSAGE);
    });
  });

  it("lets hr see every store", () => {
    expect(resolveStoreScope(requestFor("hr", { "x-user-store-id": STORE_A }))).toBeNull();
  });

  it.each<UserRole>(["customer", "driver"])("refuses %s", (role) => {
    expect(refusal(() => resolveStoreScope(requestFor(role))).errorCode).toBe(403);
  });

  it("needs an identity", () => {
    expect(refusal(() => resolveStoreScope({ header: () => undefined } as unknown as IdentifiedRequest)).errorCode).toBe(401);
  });
});

describe("effectiveStore", () => {
  const actor = (role: UserRole, headers: Record<string, string> = {}) => actorOf(requestFor(role, headers));

  it("lets an admin choose any store, the query winning over the header scope", () => {
    expect(effectiveStore(actor("admin", { "x-store-scope": STORE_A }), STORE_B)).toBe(STORE_B);
    expect(effectiveStore(actor("admin"), STORE_B)).toBe(STORE_B);
    expect(effectiveStore(actor("admin", { "x-store-scope": STORE_A }))).toBe(STORE_A);
    expect(effectiveStore(actor("admin"))).toBeNull();
  });

  it("answers 404 when a store-bound role asks for another store", () => {
    const manager = actor("manager", { "x-user-store-id": STORE_A });
    expect(refusal(() => effectiveStore(manager, STORE_B)).errorCode).toBe(404);
    expect(effectiveStore(manager, STORE_A)).toBe(STORE_A);
    expect(effectiveStore(manager)).toBe(STORE_A);
  });
});

describe("actorOf", () => {
  it("decodes the percent-encoded name and drops a malformed one", () => {
    expect(actorOf(requestFor("admin", { "x-user-name": "Meera%20Nair" })).name).toBe("Meera Nair");
    expect(actorOf(requestFor("admin", { "x-user-name": "%E0%A4%A" })).name).toBeNull();
  });
});
