import { IJob } from "../Models/Job/Job.Interface.js";
import { paiseToRupees } from "../Utils/Geo.js";

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const address = (job: IJob) => ({
  line1: job.addressLine1,
  line2: job.addressLine2,
  landmark: job.landmark,
  city: job.city,
  pincode: job.pincode,
  latitude: job.latitude,
  longitude: job.longitude,
});

/** The job as a rider's list shows it. The catalogue's `jobCard`. */
export const toJobCard = (job: IJob, etaMinutes: number | null = null) => ({
  id: job.id,
  type: job.type,
  sequence: job.sequence,
  status: job.status,
  orderId: job.orderId,
  orderNumber: job.orderNumber,
  customerName: job.customerName,
  customerPhone: job.customerPhone,
  address: address(job),
  slot: { from: iso(job.slotFrom), to: iso(job.slotTo) },
  etaMinutes,
  isPremium: job.isPremium,
  isDelicate: job.isDelicate,
  requiresInspection: job.requiresInspection,
  // Still to be collected at the door, in rupees.
  amountToCollect: paiseToRupees(Math.max(job.amountToCollectPaise - job.collectedPaise, 0)),
  storeId: job.storeId,
  // The store's name lives in commerce; logistics only knows its id.
  storeName: null,
});

/** One job in full for the rider who holds it. */
export const toRiderJobDetail = (job: IJob, etaMinutes: number | null) => ({
  ...toJobCard(job, etaMinutes),
  items: job.items.map((item) => ({
    id: item.id,
    name: item.name,
    careFlags: item.careFlags,
    customerNote: item.customerNote,
  })),
  customerCareNotes: job.careNotes,
});

/** The job as dispatch sees it. Never includes the handover code. */
export const toDispatchJob = (job: IJob) => ({
  ...toJobCard(job),
  riderId: job.riderId,
  priority: job.priority,
  notes: job.notes,
  slotFrom: iso(job.slotFrom),
  failureReason: job.failureReason,
  failureNote: job.failureNote,
  cancelReason: job.cancelReason,
  rescheduleCount: job.rescheduleCount,
  assignedAt: iso(job.assignedAt),
  startedAt: iso(job.startedAt),
  arrivedAt: iso(job.arrivedAt),
  pickedUpAt: iso(job.pickedUpAt),
  completedAt: iso(job.completedAt),
  createdAt: iso(job.createdAt),
});

/** The job as another service asks for it. This is the only view that carries the handover code. */
export const toInternalJob = (job: IJob) => ({
  ...toDispatchJob(job),
  handoverCode: job.handoverCode,
  amountToCollectPaise: job.amountToCollectPaise,
  collectedPaise: job.collectedPaise,
});
