import type { Prisma } from "@prisma/client";
import { prisma } from "../DB/Prisma.Connection.Db.js";
import type { ICustomer } from "../Models/Customer/Customer.Interface.js";
import type { ICustomerProfile } from "../Models/CustomerAccount/CustomerAccount.Interface.js";

export type Db = Prisma.TransactionClient;

const findByUserId = async (userId: string, db: Db = prisma): Promise<ICustomerProfile | null> => {
  try {
    return await db.customerProfile.findUnique({ where: { userId } });
  } catch (error) {
    throw error;
  }
};

const findByCustomerId = async (customerId: string, db: Db = prisma): Promise<ICustomerProfile | null> => {
  try {
    return await db.customerProfile.findUnique({ where: { customerId } });
  } catch (error) {
    throw error;
  }
};

// Unique on userId and customerId: a duplicate surfaces as a unique violation for the service.
const create = async (userId: string, customerId: string, db: Db = prisma): Promise<ICustomerProfile> => {
  try {
    return await db.customerProfile.create({ data: { userId, customerId } });
  } catch (error) {
    throw error;
  }
};

// A no-op UPDATE is the row lock: everything the customer does that counts or caps their own
// rows (addresses, garment profiles, orders) queues behind it. False when the row is gone.
const lock = async (id: string, db: Db): Promise<boolean> => {
  try {
    const { count } = await db.customerProfile.updateMany({ where: { id }, data: { updatedAt: new Date() } });
    return count > 0;
  } catch (error) {
    throw error;
  }
};

const setDefaultAddress = async (id: string, addressId: string | null, db: Db = prisma): Promise<void> => {
  try {
    await db.customerProfile.update({ where: { id }, data: { defaultAddressId: addressId } });
  } catch (error) {
    throw error;
  }
};

// The core Customer is shared with the staff screens and keyed by phone.
const findCustomerByPhone = async (phone: string, db: Db = prisma): Promise<ICustomer | null> => {
  try {
    return await db.customer.findUnique({ where: { phone } });
  } catch (error) {
    throw error;
  }
};

export const CustomerProfileQuery = {
  findByUserId,
  findByCustomerId,
  create,
  lock,
  setDefaultAddress,
  findCustomerByPhone,
};
