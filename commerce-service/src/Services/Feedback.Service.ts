import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import { SupportClient } from "../Clients/SupportServices.Client.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { IFeedback, IFeedbackFilter } from "../Models/Feedback/Feedback.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { FeedbackQuery } from "../Queries/Feedback.Query.js";
import { optionalText, parseBody, wholeNumber } from "../Utils/Input.js";
import {
  effectiveStore,
  idOrNotFound,
  optionalDayQuery,
  optionalIntQuery,
  optionalUuidQuery,
} from "../Utils/SupportInput.js";
import { customerUserId, findOwnedOrder } from "./CustomerLink.js";

const FEEDBACK_NOT_FOUND = "Feedback not found.";
const MAX_COMMENT = 1000;
const MS_PER_DAY = 86_400_000;
export const DEFAULT_TREND_DAYS = 90;
export const MAX_SUMMARY_DAYS = 366;

const rating = (value: unknown, field: string) => wholeNumber(value, field, 1, 5);
const optionalRating = (value: unknown, field: string) =>
  value === undefined || value === null ? null : rating(value, field);

const toCustomerView = (f: IFeedback) => ({
  id: f.id,
  orderId: f.orderId,
  rating: f.rating,
  comment: f.comment,
  storeRating: f.storeRating,
  riderRating: f.riderRating,
  createdAt: f.createdAt.toISOString(),
});

const toAdminItem = (f: IFeedback) => ({
  id: f.id,
  orderId: f.orderId,
  rating: f.rating,
  comment: f.comment,
  storeRating: f.storeRating,
  riderRating: f.riderRating,
  storeId: f.storeId,
  riderId: f.riderId,
  createdAt: f.createdAt.toISOString(),
});

const ALREADY = "Feedback was already left for this order.";

// ---------------------------------------------------------- customer side
const submit = async (user: RequestUser, orderId: string, input: unknown) => {
  try {
    const userId = customerUserId(user);
    const body = parseBody(input);
    const overall = rating(body.rating, "rating");
    const storeRating = optionalRating(body.storeRating, "storeRating");
    const riderRating = optionalRating(body.riderRating, "riderRating");
    const comment = optionalText(body.comment, "comment", MAX_COMMENT) ?? null;

    const order = await findOwnedOrder(user, orderId);
    if (order.status !== "delivered") {
      throw new CustomException("You can rate an order once it has been delivered.", conflict);
    }
    if (await FeedbackQuery.findByOrderAndCustomer(order.id, userId)) throw new CustomException(ALREADY, conflict);

    // The rider is only needed to attribute a rider rating, so logistics is asked only then.
    const riderId = riderRating === null ? null : await SupportClient.findDeliveryRiderId(order.id);
    const now = new Date();
    try {
      const saved = await FeedbackQuery.create({
        orderId: order.id,
        storeId: order.storeId,
        customerId: order.customerId,
        customerUserId: userId,
        rating: overall,
        storeRating,
        riderRating,
        riderId,
        comment,
        ratedOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      });
      return toCustomerView(saved);
    } catch (error) {
      // Two simultaneous submissions: the unique (order, customer) index lets exactly one in.
      if (isUniqueViolation(error)) throw new CustomException(ALREADY, conflict);
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const getMine = async (user: RequestUser, orderId: string) => {
  try {
    const userId = customerUserId(user);
    const found = await FeedbackQuery.findByOrderAndCustomer(idOrNotFound(orderId, FEEDBACK_NOT_FOUND), userId);
    if (!found) throw new CustomException(FEEDBACK_NOT_FOUND, notFound);
    return toCustomerView(found);
  } catch (error) {
    throw toCustomException(error);
  }
};

// -------------------------------------------------------------- admin side
const parseFilter = (scope: string | null, query: Record<string, unknown>): IFeedbackFilter => ({
  storeId: effectiveStore(scope, optionalUuidQuery(query.storeId, "storeId")),
  riderId: optionalUuidQuery(query.riderId, "riderId"),
  from: optionalDayQuery(query.from, "from", false),
  to: optionalDayQuery(query.to, "to", true),
});

const list = async (scope: string | null, query: Record<string, unknown>) => {
  try {
    const page = parsePage(query);
    const filter = { ...parseFilter(scope, query), rating: optionalIntQuery(query.rating, "rating", 1, 5) };
    const { items, total } = await FeedbackQuery.search({ ...filter, page });
    return toPage(items.map(toAdminItem), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The trend covers the last DEFAULT_TREND_DAYS days of the chosen range; the other figures
// cover the whole range. An explicit range may not be wider than a year.
const summary = async (scope: string | null, query: Record<string, unknown>) => {
  try {
    const filter = parseFilter(scope, query);
    if (filter.from && filter.to && filter.to.getTime() - filter.from.getTime() > MAX_SUMMARY_DAYS * MS_PER_DAY) {
      throw new CustomException(`The range can be at most ${MAX_SUMMARY_DAYS} days.`, badRequest);
    }
    const end = filter.to ?? new Date();
    const windowStart = new Date(end.getTime() - (DEFAULT_TREND_DAYS - 1) * MS_PER_DAY);
    const trendFrom = filter.from && filter.from > windowStart ? filter.from : windowStart;
    const result = await FeedbackQuery.summarise(filter, new Date(Date.UTC(trendFrom.getUTCFullYear(), trendFrom.getUTCMonth(), trendFrom.getUTCDate())));
    return {
      average: result.overall.average,
      count: result.overall.count,
      distribution: result.distribution,
      byStore: result.byStore,
      byRider: result.byRider,
      trend: result.trend,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const FeedbackService = { submit, getMine, list, summary };
