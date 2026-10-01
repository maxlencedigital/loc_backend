import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { conflict } from "../../commons/Utils/StatusCode.js";
import { Actor } from "../Middleware/StoreScope.js";
import { EarningsQuery } from "../Queries/Earnings.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { dayFromQuery } from "../Utils/Dates.js";
import { round1, paiseToRupees } from "../Utils/Geo.js";
import { bool, coordinates, decimal, isBlank, object } from "../Utils/Input.js";
import { shiftBonus } from "./Earnings.Rules.js";
import { eligibilityBlockers } from "./Eligibility.js";
import { riderForActor } from "./JobFlow.js";

// A rider location ping is the busiest write in the service, and the app may send it every
// few seconds. Only the latest position is kept, and pings closer together than this are dropped.
export const LOCATION_MIN_INTERVAL_MS = 5_000;

const ineligible = (blockers: Array<{ code: string; message: string }>) =>
  new CustomException(`You cannot take jobs right now: ${blockers[0].message}`, conflict, { blockers });

const profile = async (actor: Actor) => {
  try {
    const rider = await riderForActor(actor);
    return {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      vehicleType: rider.vehicleType,
      vehicleNumber: rider.vehicleNumber,
      status: rider.status,
      available: rider.available,
      onShift: rider.openShiftId !== null,
      homeStoreId: rider.homeStoreId,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const setAvailability = async (actor: Actor, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const available = bool(input.available, "available");
    const where = coordinates(input);
    const rider = await riderForActor(actor);

    if (available) {
      const blockers = eligibilityBlockers(rider);
      if (blockers.length > 0) throw ineligible(blockers);
    }
    await RiderQuery.updateRider(rider.id, {
      available,
      ...(where ? { lastLatitude: where.latitude, lastLongitude: where.longitude, lastLocationAt: new Date() } : {}),
    });
    return { available, onShift: rider.openShiftId !== null };
  } catch (error) {
    throw toCustomException(error);
  }
};

const postLocation = async (actor: Actor, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const latitude = decimal(input.latitude, "latitude", -90, 90);
    const longitude = decimal(input.longitude, "longitude", -180, 180);
    if (!isBlank(input.accuracy)) decimal(input.accuracy, "accuracy", 0, 100_000);
    if (!isBlank(input.speed)) decimal(input.speed, "speed", 0, 200);

    const rider = await riderForActor(actor);
    if (rider.openShiftId === null) throw new CustomException("Start your shift to share your location.", conflict);
    const now = new Date();
    if (rider.lastLocationAt && now.getTime() - rider.lastLocationAt.getTime() < LOCATION_MIN_INTERVAL_MS) {
      return { recorded: false };
    }
    await RiderQuery.updateRider(rider.id, { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: now });
    return { recorded: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

const startShift = async (actor: Actor, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const vehicleChecked = isBlank(input.vehicleChecked) ? false : bool(input.vehicleChecked, "vehicleChecked");
    const where = coordinates(input);
    const rider = await riderForActor(actor);

    const blockers = eligibilityBlockers(rider);
    if (blockers.length > 0) throw ineligible(blockers);
    if (rider.openShiftId !== null) throw new CustomException("You already have a shift in progress.", conflict);

    let shift;
    try {
      shift = await RiderQuery.startShift({
        riderId: rider.id,
        vehicleChecked,
        startLatitude: where?.latitude ?? null,
        startLongitude: where?.longitude ?? null,
      });
    } catch (error) {
      // Two starts at once: the unique open-shift column let exactly one in.
      if (isUniqueViolation(error)) throw new CustomException("You already have a shift in progress.", conflict);
      throw error;
    }
    if (where) {
      await RiderQuery.updateRider(rider.id, { lastLatitude: where.latitude, lastLongitude: where.longitude, lastLocationAt: new Date() });
    }
    return { shiftId: shift.id, startedAt: shift.startedAt };
  } catch (error) {
    throw toCustomException(error);
  }
};

const endShift = async (actor: Actor, body: unknown) => {
  try {
    const input = object(body ?? {}, "body");
    const odometerKm = isBlank(input.odometerKm) ? null : decimal(input.odometerKm, "odometerKm", 0, 1_000);
    const rider = await riderForActor(actor);
    const shift = await RiderQuery.openShiftOf(rider.id);
    if (!shift) throw new CustomException("You have no shift in progress.", conflict);

    // Garments still in the rider's hands must reach the store before the shift can close.
    if ((await JobQuery.countByStatusForRider(rider.id, "picked_up")) > 0) {
      throw new CustomException("Hand over the garments you collected before ending your shift.", conflict);
    }

    const closed = await JobQuery.inTransaction(async (tx) => {
      const stats = await JobQuery.shiftStats(shift.id, tx);
      await EarningsQuery.addEntries(shiftBonus(rider.id, shift.id, stats.jobsCompleted), tx);
      const earningsPaise = await EarningsQuery.shiftTotal(shift.id, tx);
      const ok = await RiderQuery.closeShift(
        shift.id,
        { endedAt: new Date(), odometerKm, jobsCompleted: stats.jobsCompleted, distanceMeters: stats.distanceMeters, earningsPaise },
        tx
      );
      if (!ok) throw new CustomException("You have no shift in progress.", conflict);
      await RiderQuery.updateRider(rider.id, { available: false }, tx);
      return { ...stats, earningsPaise };
    });

    return {
      jobsCompleted: closed.jobsCompleted,
      distanceKm: odometerKm ?? round1(closed.distanceMeters / 1000),
      earnings: paiseToRupees(closed.earningsPaise),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const summary = async (actor: Actor, query: { date?: unknown }) => {
  try {
    const { range } = dayFromQuery(query.date);
    const rider = await riderForActor(actor);
    const [done, totals, shifts] = await Promise.all([
      JobQuery.completedTotals(rider.id, range),
      EarningsQuery.totals(rider.id, range),
      RiderQuery.shiftsInRange(rider.id, range),
    ]);
    const now = Date.now();
    const hours = shifts.reduce((sum, shift) => sum + ((shift.endedAt?.getTime() ?? now) - shift.startedAt.getTime()), 0) / 3_600_000;
    const earnedPaise = (Object.entries(totals) as Array<[string, number]>)
      .filter(([kind]) => kind !== "payout")
      .reduce((sum, [, amount]) => sum + amount, 0);
    return {
      jobsCompleted: done.jobsCompleted,
      distanceKm: round1(done.distanceMeters / 1000),
      earnings: paiseToRupees(earnedPaise),
      hoursOnShift: Math.round(hours * 100) / 100,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderShiftService = { profile, setAvailability, postLocation, startShift, endShift, summary };
