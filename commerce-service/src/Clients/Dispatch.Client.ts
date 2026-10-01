import { ServiceClient } from "../../commons/Http/ServiceClient.js";

export interface IDeliveryJobRequest {
  orderId: string;
  orderRef: string;
  storeId: string;
  address: string;
  contactName: string;
  contactPhone: string;
  priority: "standard" | "express";
}

/**
 * Asks logistics for the delivery job of a packed order. Logistics answers the same job for the
 * same order (idempotent on order and type), so a retry after a failure is safe to repeat.
 */
const createDeliveryJob = async (job: IDeliveryJobRequest): Promise<string | null> => {
  const answer = await ServiceClient.post<{ id?: string; jobId?: string; job?: { id?: string } }>("logistics", "/internal/jobs", {
    body: { ...job, type: "delivery" },
    idempotent: true,
  });
  return answer?.id ?? answer?.jobId ?? answer?.job?.id ?? null;
};

export const DispatchClient = { createDeliveryJob };
