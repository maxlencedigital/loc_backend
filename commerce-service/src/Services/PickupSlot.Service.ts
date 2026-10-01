import type { ISlot, ISlotConfig } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import type { IStore } from "../Models/Store/Store.Interface.js";
import type { OrderStatus } from "../Models/Order/OrderStatus.js";
import { CustomerOrderQuery } from "../Queries/CustomerOrder.Query.js";
import { PickupSlotQuery } from "../Queries/PickupSlot.Query.js";
import { DEFAULT_SLOT_CONFIG, buildWindows, dayStart, isBookableAt, istDateOf, parseOpeningHours } from "./PickupSlots.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// Express keeps a fifth of the plant's daily kilograms free for walk-ins and rework.
export const EXPRESS_LOAD_FACTOR = 0.8;
// The statuses before "packed": weight the plant has still to wash, dry or check.
export const OPEN_LOAD_STATUSES: OrderStatus[] = [
  "booked",
  "picked_up",
  "received",
  "sorted",
  "washing",
  "drying",
  "quality_check",
];
// When express is off, the next one offered is no sooner than this.
export const EXPRESS_RETRY_HOURS = 24;

export interface IExpressDecision {
  available: boolean;
  constraints: { machine: boolean; staff: null; rider: null };
  reasons: string[];
}

/** The whole express rule. Staff and rider cover are not known to this service, so they are null. */
export const decideExpress = (input: {
  storeLive: boolean;
  capacityKgPerDay: number;
  openGrams: number;
  basketGrams: number;
}): IExpressDecision => {
  const limitGrams = input.capacityKgPerDay * 1000 * EXPRESS_LOAD_FACTOR;
  const machine = input.openGrams + input.basketGrams <= limitGrams;
  const reasons: string[] = [];
  if (!input.storeLive) reasons.push("This store is not taking orders.");
  if (!machine) reasons.push("The plant is full for today, so express cannot be promised right now.");
  return { available: input.storeLive && machine, constraints: { machine, staff: null, rider: null }, reasons };
};

export const slotConfigOf = async (storeId: string): Promise<ISlotConfig> =>
  (await PickupSlotQuery.findConfig(storeId)) ?? DEFAULT_SLOT_CONFIG;

export const expressDecisionFor = async (store: IStore, basketGrams: number): Promise<IExpressDecision> =>
  decideExpress({
    storeLive: store.status === "live",
    capacityKgPerDay: store.capacityKgPerDay,
    openGrams: await CustomerOrderQuery.sumOpenWeightGrams(store.id, OPEN_LOAD_STATUSES),
    basketGrams,
  });

// The day's slots with their live seat counts. Rows are created the first time a day is
// listed; a store whose hours cannot be read has no slots rather than invented ones.
export const daySlots = async (store: IStore, config: ISlotConfig, date: string): Promise<ISlot[]> => {
  const hours = parseOpeningHours(store.openingHours);
  if (!hours) return [];
  const windows = buildWindows(date, hours, config.slotMinutes);
  const from = dayStart(date);
  const to = new Date(from.getTime() + MS_PER_DAY);
  const existing = await PickupSlotQuery.listBetween(store.id, from, to);
  const have = new Set(existing.map((slot) => slot.startsAt.getTime()));
  const missing = windows.filter((w) => !have.has(w.startsAt.getTime()));
  if (missing.length === 0) return existing;
  await PickupSlotQuery.ensureWindows(store.id, missing, config.capacityPerSlot);
  return await PickupSlotQuery.listBetween(store.id, from, to);
};

export const isOpenForBooking = (slot: ISlot, config: ISlotConfig, now: Date): boolean =>
  slot.booked < slot.capacity && isBookableAt(slot.startsAt, now, config.leadMinutes);

/** The first bookable window starting `EXPRESS_RETRY_HOURS` from now, within the booking horizon. */
export const nextSlotAfterRetry = async (
  store: IStore,
  config: ISlotConfig,
  now: Date
): Promise<{ from: string; to: string } | null> => {
  const earliest = new Date(now.getTime() + EXPRESS_RETRY_HOURS * MS_PER_HOUR);
  const firstDay = Date.parse(`${istDateOf(earliest)}T00:00:00.000Z`);
  for (let offset = 0; offset <= config.horizonDays; offset += 1) {
    const date = new Date(firstDay + offset * MS_PER_DAY).toISOString().slice(0, 10);
    const open = (await daySlots(store, config, date)).find(
      (slot) => slot.startsAt >= earliest && isOpenForBooking(slot, config, now)
    );
    if (open) return { from: open.startsAt.toISOString(), to: open.endsAt.toISOString() };
  }
  return null;
};
