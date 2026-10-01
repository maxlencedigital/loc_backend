import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { CustomException } from "../../commons/Exception/CustomException.js";
import { notFound } from "../../commons/Utils/StatusCode.js";

// Customer identity (name, phone, email) belongs to the gateway; growth asks, never stores.
export interface GatewayUser {
  id: string;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  role: string;
  storeId: string | null;
  isActive: boolean;
}

const LOOKUP_MAX_IDS = 200;

/** Unknown ids are simply absent from the answer. Throws 503 if the gateway cannot be reached. */
const lookupUsers = async (ids: string[]): Promise<GatewayUser[]> => {
  const users: GatewayUser[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_MAX_IDS) {
    const result = await ServiceClient.post<{ users: GatewayUser[] }>("gateway", "/internal/users/lookup", {
      body: { ids: ids.slice(i, i + LOOKUP_MAX_IDS) },
      idempotent: true,
    });
    users.push(...(result?.users ?? []));
  }
  return users;
};

const getUser = async (id: string): Promise<GatewayUser | null> => {
  try {
    return await ServiceClient.get<GatewayUser>("gateway", `/internal/users/${id}`);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === notFound) return null;
    throw error;
  }
};

export const GatewayClient = { lookupUsers, getUser };
