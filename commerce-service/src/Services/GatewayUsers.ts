import { CustomException } from "../../commons/Exception/CustomException.js";
import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { badRequest, notFound } from "../../commons/Utils/StatusCode.js";

interface GatewayUser {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  role: string;
  storeId: string | null;
  isActive: boolean;
}

// Linking an employee to a login only makes sense for a real, active, non-customer account.
// The gateway owns users, so it is asked; a refusal on the merits becomes a 400 for HR,
// while an outage (503) passes through so HR knows to retry.
const verifyLinkable = async (userId: string): Promise<void> => {
  let user: GatewayUser | null;
  try {
    user = await ServiceClient.get<GatewayUser>("gateway", `/internal/users/${userId}`);
  } catch (error) {
    if (error instanceof CustomException && error.errorCode === notFound) {
      throw new CustomException("No login account exists with that id.", badRequest);
    }
    throw error;
  }
  if (!user) throw new CustomException("No login account exists with that id.", badRequest);
  if (user.role === "customer") throw new CustomException("A customer account cannot be linked to an employee.", badRequest);
  if (!user.isActive) throw new CustomException("That login account is deactivated.", badRequest);
};

// Best effort: the agreed gateway contract has no deactivate endpoint yet, so a refusal
// is reported (loginChanged: false) instead of failing the HR change that triggered it.
const setLoginActive = async (userId: string, active: boolean): Promise<boolean> => {
  try {
    await ServiceClient.post("gateway", `/internal/users/${userId}/${active ? "reactivate" : "deactivate"}`, {
      idempotent: true,
    });
    return true;
  } catch (error) {
    console.warn(`[hr-core] could not ${active ? "enable" : "disable"} login ${userId}:`, (error as Error).message);
    return false;
  }
};

export const GatewayUsers = { verifyLinkable, setLoginActive };
