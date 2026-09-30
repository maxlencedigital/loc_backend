import { CustomException } from "../Exception/CustomException.js";
import { badRequest } from "./StatusCode.js";

// Throws a 400 naming every required field that is missing or blank.
// 0 and false are valid values, so only undefined, null and "" count as missing.
export const requireFields = (body: unknown, fields: string[]): void => {
  const source = (body ?? {}) as Record<string, unknown>;
  const missing = fields.filter(
    (field) => source[field] === undefined || source[field] === null || source[field] === ""
  );
  if (missing.length > 0) {
    throw new CustomException(
      `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required.`,
      badRequest
    );
  }
};
