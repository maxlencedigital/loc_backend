import { CustomException } from "../../commons/Exception/CustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { ICustomer } from "../Models/Customer/Customer.Interface.js";
import type { ICustomerProfile } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { CustomerProfileQuery } from "../Queries/CustomerProfile.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { StoreQuery } from "../Queries/Store.Query.js";
import { isUuid } from "../Utils/Uuid.js";
import { normalizePhone } from "./Customer.Service.js";

export interface ICustomerContext {
  profile: ICustomerProfile;
  customer: ICustomer;
}

// What the gateway answers for GET /internal/users/:id (the agreed contract).
interface IGatewayUser {
  id: string;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  role: string;
  isActive: boolean;
}

export const NOT_A_CUSTOMER = "Only customers have a customer account.";
const NO_PHONE = "Add a valid mobile number to your account to continue.";
const NO_STORE = "No store is taking customers yet. Please try again later.";
const LINKED_ELSEWHERE = "This mobile number is already linked to another account.";

const fetchGatewayUser = async (user: RequestUser): Promise<IGatewayUser> => {
  try {
    return await ServiceClient.get<IGatewayUser>("gateway", `/internal/users/${encodeURIComponent(user.id)}`);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === notFound) {
      throw new CustomException("Your account could not be found.", forbidden);
    }
    throw error;
  }
};

// Finds the core Customer for a phone, or creates it in the default store: the first live
// store by code. The unique phone makes concurrent first requests converge on one row.
const linkCustomer = async (gateway: IGatewayUser): Promise<ICustomer> => {
  const phone = normalizePhone(gateway.phoneNumber ?? undefined);
  const existing = await CustomerProfileQuery.findCustomerByPhone(phone);
  if (existing) {
    // Keep what the store recorded; only fill an email they never had.
    if (!existing.email && gateway.email) {
      return await CustomerQuery.update(existing.id, { email: gateway.email.trim().toLowerCase() });
    }
    return existing;
  }
  const [store] = await StoreQuery.list(null, "live");
  if (!store) throw new CustomException(NO_STORE, serviceUnavailable);
  try {
    return await CustomerQuery.create({
      storeId: store.id,
      name: gateway.name?.trim() || "Customer",
      phone,
      email: gateway.email?.trim().toLowerCase() ?? "",
      type: "retail",
      addresses: [],
      tags: [],
    });
  } catch (error) {
    if (!isUniqueViolation(error, "phone")) throw error;
    const raced = await CustomerProfileQuery.findCustomerByPhone(phone);
    if (!raced) throw error;
    return raced;
  }
};

const createProfile = async (user: RequestUser): Promise<ICustomerProfile> => {
  const gateway = await fetchGatewayUser(user);
  if (gateway.role !== "customer" || !gateway.isActive) {
    throw new CustomException("Your account cannot place orders.", forbidden);
  }
  let customer: ICustomer;
  try {
    customer = await linkCustomer(gateway);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === badRequest) {
      throw new CustomException(NO_PHONE, badRequest);
    }
    throw error;
  }
  try {
    return await CustomerProfileQuery.create(user.id, customer.id);
  } catch (error) {
    if (isUniqueViolation(error, "uq_customer_profile_user")) {
      const raced = await CustomerProfileQuery.findByUserId(user.id);
      if (raced) return raced;
    }
    if (isUniqueViolation(error, "uq_customer_profile_customer")) {
      throw new CustomException(LINKED_ELSEWHERE, conflict);
    }
    throw error;
  }
};

/** For endpoints that need no stored data: only a customer may call them. */
export const assertCustomer = (user: RequestUser): void => {
  if (user.role !== "customer") throw new CustomException(NOT_A_CUSTOMER, forbidden);
  // The gateway always forwards a uuid; anything else is a malformed identity, not a stranger.
  if (!isUuid(user.id)) throw new CustomException("Your account identity is not valid.", badRequest);
};

// Every /me call starts here: the caller must be a customer, and their profile (and the
// core Customer it links to) is created on first use. The gateway is asked only that once.
export const resolveCustomer = async (user: RequestUser): Promise<ICustomerContext> => {
  assertCustomer(user);
  const profile = (await CustomerProfileQuery.findByUserId(user.id)) ?? (await createProfile(user));
  const customer = await CustomerQuery.findById(profile.customerId, null);
  if (!customer) throw new CustomException("Your customer record could not be found.", notFound);
  return { profile, customer };
};

/** "+91 98450 12345" as the E.164 form the contract documents. */
export const toE164 = (phone: string): string => phone.replace(/\s/g, "");
