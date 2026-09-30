import { Request } from "express";

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

// Passed to express.json as `verify`. A webhook signature covers the exact bytes
// Razorpay sent, and re-serialising the parsed JSON would change them.
export const captureRawBody = (req: Request, _res: unknown, buf: Buffer): void => {
  (req as RawBodyRequest).rawBody = buf;
};
