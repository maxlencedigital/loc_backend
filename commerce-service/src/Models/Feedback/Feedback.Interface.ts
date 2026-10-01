import type { PageRequest } from "../../../commons/Utils/Pagination.js";

export interface IFeedback {
  id: string;
  orderId: string;
  storeId: string;
  customerId: string;
  customerUserId: string;
  rating: number;
  storeRating: number | null;
  riderRating: number | null;
  riderId: string | null;
  comment: string | null;
  ratedOn: Date;
  createdAt: Date;
}

export type IFeedbackCreate = Omit<IFeedback, "id" | "createdAt">;

export interface IFeedbackFilter {
  storeId?: string | null;
  riderId?: string;
  rating?: number;
  from?: Date;
  to?: Date;
}

export interface IFeedbackPageFilter extends IFeedbackFilter {
  page: PageRequest;
}

export interface IAverage {
  average: number | null;
  count: number;
}

export interface IFeedbackSummary {
  overall: IAverage;
  distribution: Record<number, number>;
  byStore: Array<IAverage & { storeId: string }>;
  byRider: Array<IAverage & { riderId: string }>;
  trend: Array<IAverage & { date: string }>;
}
