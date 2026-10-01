import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { Actor } from "../Middleware/StoreScope.js";
import { EarningsQuery } from "../Queries/Earnings.Query.js";
import { JobQuery } from "../Queries/Job.Query.js";
import { RiderQuery } from "../Queries/Rider.Query.js";
import { rangeFromQuery } from "../Utils/Dates.js";
import { paiseToRupees, round1 } from "../Utils/Geo.js";
import { riderForActor } from "./JobFlow.js";

const EARNINGS_DEFAULT_DAYS = 7;
const EARNINGS_MAX_DAYS = 92;
const RECENT_RATINGS = 10;

const earnings = async (actor: Actor, query: { from?: unknown; to?: unknown }) => {
  try {
    const range = rangeFromQuery(query, { defaultDays: EARNINGS_DEFAULT_DAYS, maxDays: EARNINGS_MAX_DAYS });
    const rider = await riderForActor(actor);
    const [totals, done] = await Promise.all([EarningsQuery.totals(rider.id, range), JobQuery.completedTotals(rider.id, range)]);

    const base = (totals.job_base ?? 0);
    const incentives = (totals.job_express ?? 0) + (totals.shift_bonus ?? 0) + (totals.bonus ?? 0) + (totals.penalty ?? 0);
    const total = base + incentives;
    const paid = totals.payout ?? 0;
    return {
      jobsCompleted: done.jobsCompleted,
      distanceKm: round1(done.distanceMeters / 1000),
      base: paiseToRupees(base),
      incentives: paiseToRupees(incentives),
      total: paiseToRupees(total),
      paid: paiseToRupees(paid),
      due: paiseToRupees(Math.max(total - paid, 0)),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const ratings = async (actor: Actor, query: { from?: unknown; to?: unknown }) => {
  try {
    const range = rangeFromQuery(query, { defaultDays: 30, maxDays: 366 });
    const rider = await riderForActor(actor);
    const [summary, recent] = await Promise.all([
      RiderQuery.ratingSummary(rider.id, range),
      RiderQuery.recentRatings(rider.id, range, RECENT_RATINGS),
    ]);
    return {
      average: summary.average === null ? null : Math.round(summary.average * 100) / 100,
      count: summary.count,
      recent: recent.map((row) => ({ rating: row.rating, comment: row.comment, at: row.at.toISOString() })),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

const cashBalance = async (actor: Actor) => {
  try {
    const rider = await riderForActor(actor);
    const cash = await EarningsQuery.cashTotals(rider.id);
    return {
      collected: paiseToRupees(cash.collectedPaise),
      settled: paiseToRupees(cash.settledPaise),
      outstanding: paiseToRupees(cash.collectedPaise - cash.settledPaise),
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const RiderEarningsService = { earnings, ratings, cashBalance };
