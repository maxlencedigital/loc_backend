import { CustomException } from "../../commons/Exception/CustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { IOrderRef } from "../Models/CustomerPayment/CustomerPayment.Interface.js";
import { SupportOrderQuery } from "../Queries/SupportOrder.Query.js";
import { idOrNotFound } from "../Utils/SupportInput.js";
import { assertCustomer, resolveCustomer } from "./CustomerAccount.Service.js";

export const ORDER_NOT_FOUND = "Order not found.";

// The customer-to-order link is the account package's: the caller's profile row names their
// core customer, and an order is theirs when its customerId is that customer. Someone else's
// order, or an unknown one, is a 404.
export const findOwnedOrder = async (user: RequestUser, orderId: unknown): Promise<IOrderRef> => {
  const id = idOrNotFound(orderId, ORDER_NOT_FOUND);
  const { customer } = await resolveCustomer(user);
  const order = await SupportOrderQuery.findOrderForCustomer(id, customer.id);
  if (!order) throw new CustomException(ORDER_NOT_FOUND, notFound);
  return order;
};

/** The caller's gateway user id, for endpoints that only filter their own rows by it. */
export const customerUserId = (user: RequestUser): string => {
  assertCustomer(user);
  return user.id;
};
