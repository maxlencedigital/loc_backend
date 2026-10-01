import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import type { ICustomer } from "../Models/Customer/Customer.Interface.js";
import {
  ADDRESS_LABELS,
  IAddress,
  IAddressInput,
  ICustomerProfile,
} from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { CustomerQuery } from "../Queries/Customer.Query.js";
import { CustomerAddressQuery } from "../Queries/CustomerAddress.Query.js";
import { CustomerProfileQuery } from "../Queries/CustomerProfile.Query.js";
import { oneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { resolveCustomer, toE164 } from "./CustomerAccount.Service.js";

export const MAX_ADDRESSES = 20;
const ADDRESS_NOT_FOUND = "Address not found.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PINCODE = /^[1-9]\d{5}$/;

export const toAddressView = (address: IAddress, defaultAddressId: string | null) => ({
  id: address.id,
  label: address.label,
  line1: address.line1,
  line2: address.line2,
  landmark: address.landmark,
  city: address.city,
  pincode: address.pincode,
  latitude: address.latitude,
  longitude: address.longitude,
  isDefault: address.id === defaultAddressId,
  createdAt: address.createdAt.toISOString(),
  updatedAt: address.updatedAt.toISOString(),
});

export const toProfileView = (profile: ICustomerProfile, customer: ICustomer) => ({
  id: profile.id,
  name: customer.name,
  phone: toE164(customer.phone),
  email: customer.email,
  defaultAddressId: profile.defaultAddressId,
  // Complete means the account has what an order needs: a name, an email and a home for pickups.
  profileComplete: customer.name.trim() !== "" && customer.email !== "" && profile.defaultAddressId !== null,
});

const optionalLine = (value: unknown, field: string, max: number): string | undefined =>
  value === undefined || value === null || value === "" ? "" : optionalText(value, field, max);

const parseCoordinate = (value: unknown, field: string, limit: number): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new CustomException(`${field} must be a number between -${limit} and ${limit}.`, badRequest);
  }
  return value;
};

const checkPair = (latitude: number | null, longitude: number | null) => {
  if ((latitude === null) !== (longitude === null)) {
    throw new CustomException("latitude and longitude must be given together.", badRequest);
  }
};

const parseAddress = (body: Record<string, unknown>): IAddressInput => {
  const latitude = parseCoordinate(body.latitude, "latitude", 90);
  const longitude = parseCoordinate(body.longitude, "longitude", 180);
  checkPair(latitude, longitude);
  const pincode = text(body.pincode, "pincode", 6);
  if (!PINCODE.test(pincode)) throw new CustomException("pincode must be a 6-digit Indian pincode.", badRequest);
  return {
    label: oneOf(body.label, ADDRESS_LABELS, "label"),
    line1: text(body.line1, "line1", 120),
    line2: optionalLine(body.line2, "line2", 120) ?? "",
    landmark: optionalLine(body.landmark, "landmark", 80) ?? "",
    city: text(body.city, "city", 60),
    pincode,
    latitude,
    longitude,
  };
};

// Only the whitelisted fields are read, and a field that is present is validated in full.
const parseAddressPatch = (body: Record<string, unknown>, current: IAddress): Partial<IAddressInput> => {
  const data: Partial<IAddressInput> = {};
  if (body.label !== undefined) data.label = oneOf(body.label, ADDRESS_LABELS, "label");
  if (body.line1 !== undefined) data.line1 = text(body.line1, "line1", 120);
  if (body.line2 !== undefined) data.line2 = optionalLine(body.line2, "line2", 120) ?? "";
  if (body.landmark !== undefined) data.landmark = optionalLine(body.landmark, "landmark", 80) ?? "";
  if (body.city !== undefined) data.city = text(body.city, "city", 60);
  if (body.pincode !== undefined) {
    const pincode = text(body.pincode, "pincode", 6);
    if (!PINCODE.test(pincode)) throw new CustomException("pincode must be a 6-digit Indian pincode.", badRequest);
    data.pincode = pincode;
  }
  if (body.latitude !== undefined) data.latitude = parseCoordinate(body.latitude, "latitude", 90);
  if (body.longitude !== undefined) data.longitude = parseCoordinate(body.longitude, "longitude", 180);
  checkPair(data.latitude !== undefined ? data.latitude : current.latitude, data.longitude !== undefined ? data.longitude : current.longitude);
  return data;
};

const getProfile = async (user: RequestUser) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    return toProfileView(profile, customer);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Name and email live on the core Customer so the staff screens show the same person; the
// phone is the account's sign-in identity and is not editable here.
const updateProfile = async (user: RequestUser, input: unknown) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const body = parseBody(input);
    if (body.phone !== undefined) throw new CustomException("The mobile number cannot be changed here.", badRequest);

    const data: { name?: string; email?: string } = {};
    if (body.name !== undefined) data.name = text(body.name, "name", 80);
    if (body.email !== undefined) {
      const email = text(body.email, "email", 120).toLowerCase();
      if (!EMAIL_PATTERN.test(email)) throw new CustomException("email is not valid.", badRequest);
      data.email = email;
    }
    let defaultAddressId = profile.defaultAddressId;
    if (body.defaultAddressId !== undefined) {
      if (!isUuid(body.defaultAddressId) || !(await CustomerAddressQuery.findOwned(customer.id, body.defaultAddressId))) {
        throw new CustomException(ADDRESS_NOT_FOUND, notFound);
      }
      defaultAddressId = body.defaultAddressId;
      await CustomerProfileQuery.setDefaultAddress(profile.id, defaultAddressId);
    }
    const updated = Object.keys(data).length > 0 ? await CustomerQuery.update(customer.id, data) : customer;
    return toProfileView({ ...profile, defaultAddressId }, updated);
  } catch (error) {
    throw toCustomException(error);
  }
};

const listAddresses = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const page = parsePage(query);
    const { items, total } = await CustomerAddressQuery.list(customer.id, page.offset, page.limit);
    return toPage(items.map((a) => toAddressView(a, profile.defaultAddressId)), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const getAddress = async (user: RequestUser, id: string) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const address = isUuid(id) ? await CustomerAddressQuery.findOwned(customer.id, id) : null;
    if (!address) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
    return toAddressView(address, profile.defaultAddressId);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The profile row is locked first, so two simultaneous adds cannot both slip under the cap
// and the first address always becomes the default.
const createAddress = async (user: RequestUser, input: unknown) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const data = parseAddress(parseBody(input));
    return await CustomerAddressQuery.inTransaction(async (tx) => {
      await CustomerProfileQuery.lock(profile.id, tx);
      if ((await CustomerAddressQuery.count(customer.id, tx)) >= MAX_ADDRESSES) {
        throw new CustomException(`You can save up to ${MAX_ADDRESSES} addresses.`, conflict);
      }
      const created = await CustomerAddressQuery.create(customer.id, data, tx);
      const current = (await CustomerProfileQuery.findByUserId(user.id, tx))?.defaultAddressId ?? null;
      if (current === null) await CustomerProfileQuery.setDefaultAddress(profile.id, created.id, tx);
      return toAddressView(created, current ?? created.id);
    });
  } catch (error) {
    throw toCustomException(error);
  }
};

const updateAddress = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    const current = isUuid(id) ? await CustomerAddressQuery.findOwned(customer.id, id) : null;
    if (!current) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
    const data = parseAddressPatch(parseBody(input), current);
    const updated = Object.keys(data).length === 0 ? current : await CustomerAddressQuery.update(customer.id, id, data);
    if (!updated) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
    return toAddressView(updated, profile.defaultAddressId);
  } catch (error) {
    throw toCustomException(error);
  }
};

// Deleting the default hands the role to the newest remaining address, in the same transaction.
const deleteAddress = async (user: RequestUser, id: string) => {
  try {
    const { profile, customer } = await resolveCustomer(user);
    if (!isUuid(id)) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
    await CustomerAddressQuery.inTransaction(async (tx) => {
      await CustomerProfileQuery.lock(profile.id, tx);
      if (!(await CustomerAddressQuery.remove(customer.id, id, tx))) throw new CustomException(ADDRESS_NOT_FOUND, notFound);
      const fresh = await CustomerProfileQuery.findByUserId(user.id, tx);
      if (fresh?.defaultAddressId === id) {
        const next = await CustomerAddressQuery.findLatest(customer.id, tx);
        await CustomerProfileQuery.setDefaultAddress(profile.id, next?.id ?? null, tx);
      }
    });
    return null;
  } catch (error) {
    throw toCustomException(error);
  }
};

export const CustomerProfileService = {
  getProfile,
  updateProfile,
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
};
