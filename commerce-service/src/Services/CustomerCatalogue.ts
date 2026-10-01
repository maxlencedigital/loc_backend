import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { GarmentCategory, IPricingList, IService } from "../Models/Catalog/Catalog.Interface.js";
import type { CustomerType } from "../Models/Customer/Customer.Interface.js";
import { FABRICS, Fabric } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import { CatalogQuery } from "../Queries/Catalog.Query.js";
import { garmentTypeIdOf } from "../Utils/GarmentTypeId.js";
import { optionalOneOf, optionalText, parseBody } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";
import { ILine, MAX_ORDER_LINES, parseLines, rankLists } from "./OrderPricing.js";

export interface IGarmentType {
  id: string;
  name: string;
  category: GarmentCategory;
  // "kg" only when every service that prices it is sold by weight.
  unit: "piece" | "kg";
}

export interface ICatalogue {
  services: Map<string, IService>;
  lists: IPricingList[];
  types: Map<string, IGarmentType>;
}

type Row = IPricingList["rows"][number];

export const garmentTypesOf = (lists: IPricingList[], services: Map<string, IService>): Map<string, IGarmentType> => {
  const types = new Map<string, IGarmentType>();
  for (const row of lists.flatMap((list) => list.rows)) {
    const byWeight = services.get(row.serviceId)?.unit === "kg";
    const id = garmentTypeIdOf(row.category, row.garment);
    const known = types.get(id);
    if (known) known.unit = known.unit === "kg" && byWeight ? "kg" : "piece";
    else types.set(id, { id, name: row.garment, category: row.category, unit: byWeight ? "kg" : "piece" });
  }
  return types;
};

// With a store, only the lists that apply to it and the customer's type; without one (care
// questions, garment profiles) every active list, since only the set of garments matters.
export const loadCatalogue = async (scope: { storeId: string; customerType: CustomerType } | null): Promise<ICatalogue> => {
  const all = await CatalogQuery.listServices();
  const services = new Map(all.map((s) => [s.id, s]));
  const active = await CatalogQuery.findActiveForPricing(all.filter((s) => s.active).map((s) => s.id));
  const lists = scope ? rankLists(active, scope.storeId, scope.customerType) : active;
  return { services, lists, types: garmentTypesOf(lists, services) };
};

/** The effective price of each service and garment type: the most specific list that has a row wins. */
export const effectivePrices = (lists: IPricingList[]): { serviceId: string; garmentTypeId: string; row: Row }[] => {
  const seen = new Map<string, { serviceId: string; garmentTypeId: string; row: Row }>();
  for (const row of lists.flatMap((list) => list.rows)) {
    const garmentTypeId = garmentTypeIdOf(row.category, row.garment);
    const key = `${row.serviceId}|${garmentTypeId}`;
    if (!seen.has(key)) seen.set(key, { serviceId: row.serviceId, garmentTypeId, row });
  }
  return [...seen.values()];
};

export interface IBasketItem {
  line: ILine;
  garmentTypeId: string;
  garmentProfileId: string | null;
  fabric: Fabric;
  note: string;
}

const MAX_ITEM_NOTE = 200;

// Turns the contract's items (garment type id, service id, pieces or kilograms) into the
// lines the pricing code already knows. Prices are never read from the request.
export const parseBasket = (rawItems: unknown, catalogue: ICatalogue): IBasketItem[] => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new CustomException("items must list at least one item.", badRequest);
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    throw new CustomException(`An order can have at most ${MAX_ORDER_LINES} items.`, badRequest);
  }
  const extras = rawItems.map((raw, index) => {
    const label = `Item ${index + 1}`;
    const item = parseBody(raw);
    const type = isUuid(item.garmentTypeId) ? catalogue.types.get(item.garmentTypeId) : undefined;
    if (!type) throw new CustomException(`${label}: garmentTypeId is not available here.`, badRequest);
    const service = isUuid(item.serviceId) ? catalogue.services.get(item.serviceId) : undefined;
    if (!service) throw new CustomException(`${label}: unknown service.`, badRequest);

    const byWeight = service.unit === "kg";
    const qty = byWeight ? item.weightKg : item.quantity;
    if (qty === undefined) {
      throw new CustomException(`${label}: ${byWeight ? "weightKg is required" : "quantity is required"} for ${service.name}.`, badRequest);
    }
    if (item.garmentProfileId !== undefined && item.garmentProfileId !== null && !isUuid(item.garmentProfileId)) {
      throw new CustomException(`${label}: garmentProfileId is not valid.`, badRequest);
    }
    return {
      raw: { serviceId: service.id, garment: type.name, category: type.category, qty },
      garmentTypeId: type.id,
      garmentProfileId: (item.garmentProfileId as string | null | undefined) ?? null,
      fabric: optionalOneOf(item.fabric, FABRICS, `${label}: fabric`) ?? "unknown",
      note: optionalText(item.note, `${label}: note`, MAX_ITEM_NOTE) ?? "",
    };
  });
  const lines = parseLines(extras.map((e) => e.raw));
  return extras.map(({ raw: _raw, ...rest }, index) => ({ line: lines[index] as ILine, ...rest }));
};
