import { ServiceClient } from "../../commons/Http/ServiceClient.js";

// Sends a message through growth's notification hub. A reminder that cannot be delivered is
// reported back as "not delivered"; it never throws, so a failed notification cannot fail the
// finance operation that asked for it.

export interface IDispatchResult {
  delivered: boolean;
  error: string | null;
}

const dispatch = async (message: {
  channel: "sms" | "email" | "whatsapp";
  to: string;
  templateId: string;
  params: Record<string, string | number>;
  customerId?: string;
}): Promise<IDispatchResult> => {
  try {
    const result = await ServiceClient.post<{ delivered?: boolean; error?: string }>(
      "growth",
      "/internal/notifications/dispatch",
      { body: message }
    );
    return { delivered: result?.delivered === true, error: result?.delivered === true ? null : "not_delivered" };
  } catch {
    return { delivered: false, error: "unavailable" };
  }
};

export const GrowthClient = { dispatch };
