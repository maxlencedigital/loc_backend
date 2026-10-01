// Builders for the HR people tests. The test files own the jest.mock lines (they must be
// hoisted there); this kit creates the world on top of the real services and the fake.
import crypto from "crypto";
import { CustomException } from "../../commons/Exception/CustomException.js";
import type { IdentifiedRequest, RequestUser, UserRole } from "../Middleware/Identity.js";
import { resolveStoreScope } from "../Middleware/StoreScope.js";
import { clock } from "../Utils/HrDate.js";
import { seed } from "./InMemoryHrPeople.js";

// 10:30 IST on Thursday 2026-10-01.
export const FIXED_NOW = "2026-10-01T05:00:00.000Z";

export const setNow = (iso: string = FIXED_NOW) => jest.spyOn(clock, "now").mockImplementation(() => new Date(iso));

export const actor = (role: UserRole, storeId: string | null = null, name: string | null = null, id = `${role}-user`): RequestUser => ({
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

export const ref = (employee: any) => ({
  id: employee.id,
  code: employee.code,
  name: employee.name,
  employeeType: employee.employeeType,
  storeId: employee.storeId,
  role: employee.role,
  designation: employee.designation,
  status: employee.status,
  gatewayUserId: employee.gatewayUserId,
  reportingTo: employee.reportingTo,
  joinDate: employee.joinDate,
});

export interface World {
  storeA: string;
  storeB: string;
  admin: RequestUser;
  hr: RequestUser;
  managerA: RequestUser;
  managerB: RequestUser;
  hrPerson: any;
  managerPersonA: any;
  a1: any;
  a2: any;
  b1: any;
}

export const buildWorld = (): World => {
  const storeA = crypto.randomUUID();
  const storeB = crypto.randomUUID();
  const hrUser = actor("hr", null, "Hema HR", crypto.randomUUID());
  const managerA = actor("manager", storeA, "Meera Nair", crypto.randomUUID());
  return {
    storeA,
    storeB,
    admin: actor("admin"),
    hr: hrUser,
    managerA,
    managerB: actor("manager", storeB, null, crypto.randomUUID()),
    hrPerson: seed.employee({ name: "Hema HR", employeeType: "hr", gatewayUserId: hrUser.id }),
    managerPersonA: seed.employee({ name: "Meera Nair", employeeType: "manager", storeId: storeA, gatewayUserId: managerA.id }),
    a1: seed.employee({ name: "Asha", storeId: storeA }),
    a2: seed.employee({ name: "Bina", storeId: storeA }),
    b1: seed.employee({ name: "Chitra", storeId: storeB }),
  };
};
