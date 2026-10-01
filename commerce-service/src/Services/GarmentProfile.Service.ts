import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { FABRICS, IGarmentProfile, IGarmentProfileInput, IPhoto } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { CustomerProfileQuery } from "../Queries/CustomerProfile.Query.js";
import { CustomerPhotoQuery } from "../Queries/CustomerPhoto.Query.js";
import { GarmentProfileQuery } from "../Queries/GarmentProfile.Query.js";
import { oneOf, parseBody, text } from "../Utils/Input.js";
import { parsePhotoNote, parsePhotoUrl } from "../Utils/PhotoInput.js";
import { isUuid } from "../Utils/Uuid.js";
import { resolveCustomer } from "./CustomerAccount.Service.js";
import { loadCatalogue } from "./CustomerCatalogue.js";

export const MAX_GARMENT_PROFILES = 100;
export const MAX_GARMENT_PHOTOS = 5;
export const MAX_HISTORY_VISITS = 50;
const NOT_FOUND = "Garment profile not found.";
const MAX_LIST_ITEMS = 10;

export const toPhotoView = (photo: IPhoto) => ({
  id: photo.id,
  url: photo.url,
  note: photo.note,
  ...(photo.itemId ? { itemId: photo.itemId } : {}),
  createdAt: photo.createdAt.toISOString(),
});

const toView = (profile: IGarmentProfile, photos: IPhoto[]) => ({
  id: profile.id,
  name: profile.name,
  garmentTypeId: profile.garmentTypeId,
  fabric: profile.fabric,
  colour: profile.colour,
  brand: profile.brand,
  washInstructions: profile.washInstructions,
  avoid: profile.avoid,
  notes: profile.notes,
  isFavourite: profile.isFavourite,
  photos: photos.map(toPhotoView),
  createdAt: profile.createdAt.toISOString(),
  updatedAt: profile.updatedAt.toISOString(),
});

// An empty value clears the field; anything else is validated like a required one.
const clearable = (value: unknown, field: string, max: number): string =>
  value === null || value === "" ? "" : text(value, field, max);

const textList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new CustomException(`${field} must be a list of at most ${MAX_LIST_ITEMS} entries.`, badRequest);
  }
  return value.map((entry) => text(entry, field, 80));
};

const parseGarmentTypeId = async (value: unknown): Promise<string | null> => {
  if (value === null) return null;
  if (!isUuid(value)) throw new CustomException("garmentTypeId is not valid.", badRequest);
  if (!(await loadCatalogue(null)).types.has(value)) {
    throw new CustomException("garmentTypeId is not a garment we handle.", badRequest);
  }
  return value;
};

// Whitelisted fields only; `required` is true on create, where a name must be given.
const parseProfile = async (body: Record<string, unknown>, required: boolean): Promise<Partial<IGarmentProfileInput> & { name?: string }> => {
  const data: Partial<IGarmentProfileInput> = {};
  if (required || body.name !== undefined) data.name = text(body.name, "name", 80);
  if (body.garmentTypeId !== undefined) data.garmentTypeId = await parseGarmentTypeId(body.garmentTypeId);
  if (body.fabric !== undefined) data.fabric = oneOf(body.fabric, FABRICS, "fabric");
  if (body.colour !== undefined) data.colour = clearable(body.colour, "colour", 40);
  if (body.brand !== undefined) data.brand = clearable(body.brand, "brand", 60);
  if (body.washInstructions !== undefined) data.washInstructions = textList(body.washInstructions, "washInstructions");
  if (body.avoid !== undefined) data.avoid = textList(body.avoid, "avoid");
  if (body.notes !== undefined) data.notes = clearable(body.notes, "notes", 300);
  if (body.isFavourite !== undefined) {
    if (typeof body.isFavourite !== "boolean") throw new CustomException("isFavourite must be true or false.", badRequest);
    data.isFavourite = body.isFavourite;
  }
  return data;
};

const photosOf = async (profileIds: string[]) => {
  const photos = await CustomerPhotoQuery.listByOwners("garment_profile", profileIds);
  const byProfile = new Map<string, IPhoto[]>();
  for (const photo of photos) byProfile.set(photo.ownerId, [...(byProfile.get(photo.ownerId) ?? []), photo]);
  return byProfile;
};

const list = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const { customer } = await resolveCustomer(user);
    const page = parsePage(query);
    const { items, total } = await GarmentProfileQuery.list(customer.id, page.offset, page.limit);
    const photos = await photosOf(items.map((p) => p.id));
    return toPage(items.map((p) => toView(p, photos.get(p.id) ?? [])), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

const ownedOrThrow = async (customerId: string, id: string): Promise<IGarmentProfile> => {
  const profile = isUuid(id) ? await GarmentProfileQuery.findOwned(customerId, id) : null;
  if (!profile) throw new CustomException(NOT_FOUND, notFound);
  return profile;
};

const get = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    const profile = await ownedOrThrow(customer.id, id);
    return toView(profile, (await photosOf([profile.id])).get(profile.id) ?? []);
  } catch (error) {
    throw toCustomException(error);
  }
};

const create = async (user: RequestUser, input: unknown) => {
  try {
    const { profile: account, customer } = await resolveCustomer(user);
    const data = await parseProfile(parseBody(input), true);
    const created = await GarmentProfileQuery.inTransaction(async (tx) => {
      await CustomerProfileQuery.lock(account.id, tx);
      if ((await GarmentProfileQuery.count(customer.id, tx)) >= MAX_GARMENT_PROFILES) {
        throw new CustomException(`You can save up to ${MAX_GARMENT_PROFILES} garment profiles.`, conflict);
      }
      return await GarmentProfileQuery.create(
        customer.id,
        {
          name: data.name as string,
          garmentTypeId: data.garmentTypeId ?? null,
          fabric: data.fabric ?? "unknown",
          colour: data.colour ?? "",
          brand: data.brand ?? "",
          washInstructions: data.washInstructions ?? [],
          avoid: data.avoid ?? [],
          notes: data.notes ?? "",
          isFavourite: data.isFavourite ?? false,
        },
        tx
      );
    });
    return toView(created, []);
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    const current = await ownedOrThrow(customer.id, id);
    const data = await parseProfile(parseBody(input), false);
    const updated = Object.keys(data).length === 0 ? current : await GarmentProfileQuery.update(customer.id, id, data);
    if (!updated) throw new CustomException(NOT_FOUND, notFound);
    return toView(updated, (await photosOf([id])).get(id) ?? []);
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    if (!isUuid(id)) throw new CustomException(NOT_FOUND, notFound);
    const removed = await GarmentProfileQuery.inTransaction((tx) => GarmentProfileQuery.remove(customer.id, id, tx));
    if (!removed) throw new CustomException(NOT_FOUND, notFound);
    return null;
  } catch (error) {
    throw toCustomException(error);
  }
};

// Every order this garment was on, newest first, capped (no paging in the contract).
const history = async (user: RequestUser, id: string) => {
  try {
    const { customer } = await resolveCustomer(user);
    await ownedOrThrow(customer.id, id);
    const visits = await GarmentProfileQuery.history(customer.id, id, MAX_HISTORY_VISITS);
    return {
      visits: visits.map((visit) => ({
        orderId: visit.orderId,
        storeId: visit.storeId,
        storeName: visit.storeName,
        date: visit.placedAt.toISOString().slice(0, 10),
        service: visit.service,
        careNotes: visit.careNote,
      })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

// The profile row is locked while the photo count is checked, so two uploads cannot both pass.
const addPhoto = async (user: RequestUser, id: string, input: unknown) => {
  try {
    const { customer } = await resolveCustomer(user);
    await ownedOrThrow(customer.id, id);
    const body = parseBody(input);
    const photo = { itemId: null, url: parsePhotoUrl(body.url, "url"), note: parsePhotoNote(body.note, "note") };
    const [created] = await GarmentProfileQuery.inTransaction(async (tx) => {
      if (!(await GarmentProfileQuery.lock(customer.id, id, tx))) throw new CustomException(NOT_FOUND, notFound);
      if ((await CustomerPhotoQuery.count("garment_profile", id, tx)) >= MAX_GARMENT_PHOTOS) {
        throw new CustomException(`A garment profile can have at most ${MAX_GARMENT_PHOTOS} photos.`, conflict);
      }
      return await CustomerPhotoQuery.createMany(customer.id, "garment_profile", id, [photo], tx);
    });
    return toPhotoView(created as IPhoto);
  } catch (error) {
    throw toCustomException(error);
  }
};

export const GarmentProfileService = { list, get, create, update, remove, history, addPhoto };
