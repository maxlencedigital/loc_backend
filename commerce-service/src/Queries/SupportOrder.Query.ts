import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import { IOrderRef } from "../Models/CustomerPayment/CustomerPayment.Interface.js";

export type Db = Prisma.TransactionClient;

const orderSelect = {
  id: true,
  ref: true,
  storeId: true,
  customerId: true,
  status: true,
  paymentStatus: true,
  amountPaise: true,
} satisfies Prisma.OrderSelect;

// The only place complaints, feedback, tickets and payments read the core order table. The
// customer-to-order link itself (user to customer) is the account package's, see CustomerLink.ts.

/** An order that belongs to this customer; anyone else's id is simply not found. */
const findOrderForCustomer = async (orderId: string, customerId: string, db: Db = prisma): Promise<IOrderRef | null> => {
  try {
    return await db.order.findFirst({ where: { id: orderId, customerId }, select: orderSelect });
  } catch (error) {
    throw error;
  }
};

/** An order inside a store scope (null = every store), for staff and admins. */
const findOrderInScope = async (orderId: string, scope: string | null, db: Db = prisma): Promise<IOrderRef | null> => {
  try {
    return await db.order.findFirst({
      where: { id: orderId, ...(scope ? { storeId: scope } : {}) },
      select: orderSelect,
    });
  } catch (error) {
    throw error;
  }
};

const orderHasItem = async (orderId: string, itemId: string, db: Db = prisma): Promise<boolean> => {
  try {
    return (await db.orderItem.count({ where: { id: itemId, orderId } })) > 0;
  } catch (error) {
    throw error;
  }
};

export const SupportOrderQuery = { findOrderForCustomer, findOrderInScope, orderHasItem };
