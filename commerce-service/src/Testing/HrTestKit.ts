// Shared builders for the HR core tests. The test files own the jest.mock lines (they must
// be hoisted there); this kit only creates the world on top of the real services.
import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { EmployeeService } from "../Services/Employee.Service.js";
import { clock } from "../Utils/HrDate.js";
import { seed } from "./InMemoryHr.js";

// 10:30 IST on Thursday 2026-10-01.
export const FIXED_NOW = new Date("2026-10-01T05:00:00.000Z");
export const TODAY = "2026-10-01";

export const setNow = (iso: string) => jest.spyOn(clock, "now").mockImplementation(() => new Date(iso));

export const actor = (role: UserRole, storeId: string | null = null, name: string | null = null, id = `${role}-1`): RequestUser => ({
  id,
  role,
  storeId,
  scopeStoreId: null,
  name,
});

export const scopeOf = (user: RequestUser, scopeStoreId: string | null = null) =>
  resolveStoreScope({ user: { ...user, scopeStoreId } } as IdentifiedRequest);

export const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};

export const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
};

export interface World {
  storeA: any;
  storeB: any;
  admin: RequestUser;
  hr: RequestUser;
  managerA: RequestUser;
  managerB: RequestUser;
}

export const buildWorld = (): World => {
  const storeA = seed.store({ code: "BLR-IND", name: "Indiranagar" });
  const storeB = seed.store({ code: "BLR-KOR", name: "Koramangala" });
  return {
    storeA,
    storeB,
    admin: actor("admin"),
    hr: actor("hr"),
    managerA: actor("manager", storeA.id, "Meera Nair"),
    managerB: actor("manager", storeB.id),
  };
};

let counter = 0;
export const resetCounter = () => {
  counter = 0;
};

// Hires through the real service, so every test starts from a record the rules accepted.
export const hire = async (hr: RequestUser, over: Record<string, unknown> = {}): Promise<any> => {
  counter += 1;
  return await EmployeeService.create(hr, {
    name: `Person ${String(counter).padStart(3, "0")}`,
    employeeType: "staff",
    phone: `+91984501${String(1000 + counter)}`,
    role: "Washer",
    joinDate: "2026-01-01",
    ...over,
  });
};
