import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { GARMENT_CATEGORIES, GarmentCategory, IPricingList, IService } from "../Models/Catalog/Catalog.Interface.js";
import { CustomerType } from "../Models/Customer/Customer.Interface.js";
import { IOrderItemCreate, OrderPriority } from "../Models/Order/Order.Interface.js";
import { oneOf, parseBody, text } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

export const MAX_ORDER_LINES = 50;
// 500 kg or 500 pieces on one line is already a wholesale job; past it is a typo.
export const MAX_LINE_QUANTITY_MILLI = 500_000;
// The order total is a 32-bit column, and far past any real laundry bill.
export const MAX_ORDER_AMOUNT_PAISE = 2_000_000_000;
// A weighed bag has no piece count; the floor needs a working estimate for capacity planning.
export const ESTIMATED_PIECES_PER_KG = 4;

export interface ILine {
  serviceId: string;
  garment: string;
  category: GarmentCategory;
  quantityMilli: number;
}

export interface IPricedOrder {
  items: IOrderItemCreate[];
  pieces: number;
  weightGrams: number;
  amountPaise: number;
}

const fail = (message: string): never => {
  throw new CustomException(message, badRequest);
};

const parseQuantity = (value: unknown, label: string): number => {
  const qty = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(qty) || qty <= 0) return fail(`${label}: qty must be a number greater than zero.`);
  const milli = Math.round(qty * 1000);
  if (Math.abs(qty * 1000 - milli) > 1e-6) return fail(`${label}: qty allows at most three decimals.`);
  if (milli > MAX_LINE_QUANTITY_MILLI) return fail(`${label}: qty is too large.`);
  return milli;
};

// Structure only. A `rate`, `amount`, `price` or `unit` the client sends is never read: the
// price list and the service decide them in priceOrder().
export const parseLines = (rawItems: unknown): ILine[] => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return fail("items must list at least one item.");
  if (rawItems.length > MAX_ORDER_LINES) return fail(`An order can have at most ${MAX_ORDER_LINES} items.`);
  return rawItems.map((raw, index) => {
    const label = `Item ${index + 1}`;
    const item = parseBody(raw);
    if (!isUuid(item.serviceId)) return fail(`${label}: serviceId is not a valid service.`);
    return {
      serviceId: item.serviceId,
      garment: text(item.garment, `${label}: garment`, 80),
      category: oneOf(item.category, GARMENT_CATEGORIES, `${label}: category`),
      quantityMilli: parseQuantity(item.qty, label),
    };
  });
};

// The lists that may price this order, most specific first: a store-specific list beats a
// customer-type list, which beats the general one. A list narrowed to another store or
// customer type does not apply at all.
export const rankLists = (lists: IPricingList[], storeId: string, customerType: CustomerType): IPricingList[] => {
  const specificity = (list: IPricingList): number => (list.storeId ? 2 : 0) + (list.customerType ? 1 : 0);
  return lists
    .filter((list) => (!list.storeId || list.storeId === storeId) && (!list.customerType || list.customerType === customerType))
    .sort((a, b) => specificity(b) - specificity(a) || a.name.localeCompare(b.name));
};

const rowKey = (serviceId: string, garment: string, category: string) =>
  `${serviceId}|${garment.toLowerCase()}|${category}`;

type PricingRow = IPricingList["rows"][number];

// An exact service + garment + category row wins, from the most specific list that has one.
// A coarse booking ("Men's garments") has no such row, so it gets the service's base row: in
// the most specific list that prices the service at all, the cheapest row in the same
// category, else the cheapest row of the service.
const findRow = (lists: IPricingList[], indexed: Map<string, PricingRow>[], line: ILine): PricingRow | undefined => {
  const key = rowKey(line.serviceId, line.garment, line.category);
  const exact = indexed.map((rows) => rows.get(key)).find((found) => found !== undefined);
  if (exact) return exact;

  const cheapest = (rows: PricingRow[]) =>
    [...rows].sort((a, b) => a.ratePaise - b.ratePaise || a.garment.localeCompare(b.garment))[0];
  for (const list of lists) {
    const ofService = list.rows.filter((row) => row.serviceId === line.serviceId);
    if (ofService.length === 0) continue;
    const sameCategory = ofService.filter((row) => row.category === line.category);
    return cheapest(sameCategory.length > 0 ? sameCategory : ofService);
  }
  return undefined;
};

// Every price comes from the ranked lists, never from the client.
export const priceOrder = (
  lines: ILine[],
  services: Map<string, IService>,
  rankedLists: IPricingList[],
  priority: OrderPriority
): IPricedOrder => {
  const indexed = rankedLists.map(
    (list) => new Map(list.rows.map((row) => [rowKey(row.serviceId, row.garment, row.category), row]))
  );

  const items = lines.map((line, index): IOrderItemCreate => {
    const label = `Item ${index + 1}`;
    const service = services.get(line.serviceId);
    if (!service) return fail(`${label}: unknown service.`);
    if (!service.active) return fail(`${label}: ${service.name} is not currently offered.`);
    if (service.unit !== "kg" && line.quantityMilli % 1000 !== 0) {
      return fail(`${label}: ${service.name} is sold by the ${service.unit}, so qty must be a whole number.`);
    }
    if (priority === "express" && !service.expressAvailable) {
      return fail(`${label}: ${service.name} is not available as express.`);
    }

    const row = findRow(rankedLists, indexed, line);
    if (!row) return fail(`${label}: ${service.name} has no price on the active price list.`);

    const ratePaise = priority === "express" ? row.expressRatePaise : row.ratePaise;
    return {
      serviceId: service.id,
      serviceName: service.name,
      // The row's spelling for an exact match; the booking's own wording for a coarse one.
      garment: row.garment.toLowerCase() === line.garment.toLowerCase() ? row.garment : line.garment,
      category: line.category,
      unit: service.unit,
      quantityMilli: line.quantityMilli,
      ratePaise,
      // Quantity is in thousandths, so this is exact integer arithmetic before the one rounding.
      amountPaise: Math.round((line.quantityMilli * ratePaise) / 1000),
    };
  });

  const amountPaise = items.reduce((total, item) => total + item.amountPaise, 0);
  if (amountPaise > MAX_ORDER_AMOUNT_PAISE) return fail("This order total is too large.");

  const weightGrams = items.filter((i) => i.unit === "kg").reduce((total, i) => total + i.quantityMilli, 0);
  const pieces = items.reduce(
    (total, i) => total + (i.unit === "kg" ? Math.ceil((i.quantityMilli / 1000) * ESTIMATED_PIECES_PER_KG) : i.quantityMilli / 1000),
    0
  );
  return { items, pieces, weightGrams, amountPaise };
};
