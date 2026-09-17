export interface IActivityLog {
  id: string;
  service: string;
  method: string;
  path: string;
  userId?: string | null;
  statusCode: number;
  ip?: string | null;
  createdAt?: Date;
}

export type IActivityLogCreate = Omit<IActivityLog, "id" | "createdAt">;
