import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { parsePage, toPage } from "../../commons/Utils/Pagination.js";
import { badRequest, conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { RequestUser } from "../Middleware/Identity.js";
import { ISavedMethod, SavedMethodType } from "../Models/CustomerPayment/CustomerPayment.Interface.js";
import { CustomerPaymentQuery } from "../Queries/CustomerPayment.Query.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { optionalOneOf, optionalText, parseBody, text } from "../Utils/Input.js";
import { optionalBoolean, idOrNotFound } from "../Utils/SupportInput.js";
import { customerUserId } from "./CustomerLink.js";

export const MAX_SAVED_METHODS = 10;
const METHOD_TYPES: SavedMethodType[] = ["card", "upi"];
const TOKEN_FORMAT = /^[A-Za-z0-9_\-.:]{8,128}$/;
const BRAND_FORMAT = /^[A-Za-z][A-Za-z ]{0,19}$/;
const NOT_FOUND = "Payment method not found.";
const NEVER_CARD = "Card numbers are never accepted. Send the gateway's token and the last 4 digits only.";

// Any run of 9 or more digits (spaces and dashes ignored) is treated as a card, phone or
// account number. Nothing a customer sends us for display may contain one.
const hasLongDigitRun = (value: string): boolean => /\d{9,}/.test(value.replace(/[\s-]/g, ""));

const toView = (m: ISavedMethod) => ({
  id: m.id,
  type: m.type,
  label: m.label,
  brand: m.brand,
  last4: m.last4,
  isDefault: m.isDefault,
});

const parseLast4 = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
    throw new CustomException("last4 must be exactly 4 digits.", badRequest);
  }
  return value;
};

const parseDisplay = (body: Record<string, unknown>) => {
  const type = optionalOneOf(body.type, METHOD_TYPES, "type") ?? "card";
  const last4 = parseLast4(body.last4);
  const brand = optionalText(body.brand, "brand", 20) ?? null;
  if (brand !== null && !BRAND_FORMAT.test(brand)) throw new CustomException("brand is not valid.", badRequest);
  const given = optionalText(body.label, "label", 40);
  if (given !== undefined && hasLongDigitRun(given)) throw new CustomException(NEVER_CARD, badRequest);
  const kind = type === "upi" ? "UPI" : brand ?? "Card";
  const label = given ?? (last4 ? `${kind} ending ${last4}` : kind);
  return { type, last4, brand, label };
};

const listMine = async (user: RequestUser, query: Record<string, unknown>) => {
  try {
    const userId = customerUserId(user);
    const page = parsePage(query);
    const { items, total } = await CustomerPaymentQuery.listMethods(userId, page.offset, page.limit);
    return toPage(items.map(toView), total, page);
  } catch (error) {
    throw toCustomException(error);
  }
};

// The token is the gateway's reference to a method it holds; this service stores it and the
// masked display text and nothing else. Saving the same token again returns the saved method.
const add = async (user: RequestUser, input: unknown) => {
  try {
    const userId = customerUserId(user);
    const body = parseBody(input);
    const token = text(body.gatewayToken, "gatewayToken", 128);
    if (/^[\d\s-]{12,}$/.test(token)) throw new CustomException(NEVER_CARD, badRequest);
    if (!TOKEN_FORMAT.test(token)) throw new CustomException("gatewayToken is not a valid gateway token.", badRequest);
    const display = parseDisplay(body);
    const wantsDefault = optionalBoolean(body.isDefault, "isDefault") ?? false;

    const existing = await CustomerPaymentQuery.findMethodByToken(userId, token);
    if (existing) return { created: false, data: toView(existing) };

    try {
      const saved = await CustomerPaymentQuery.inTransaction(async (tx) => {
        // A soft cap: two simultaneous adds at the limit can overshoot by one, which is harmless.
        const count = await CustomerPaymentQuery.countMethods(userId, tx);
        if (count >= MAX_SAVED_METHODS) {
          throw new CustomException(`You can save at most ${MAX_SAVED_METHODS} payment methods.`, conflict);
        }
        // The first method is the default; asking for another default moves it.
        const makeDefault = wantsDefault || count === 0;
        if (makeDefault) await CustomerPaymentQuery.clearDefault(userId, tx);
        return await CustomerPaymentQuery.createMethod(
          { customerUserId: userId, providerToken: token, ...display, isDefault: makeDefault },
          tx
        );
      });
      return { created: true, data: toView(saved) };
    } catch (error) {
      if (isUniqueViolation(error, "saved_method_token") || isUniqueViolation(error, "providerToken")) {
        const raced = await CustomerPaymentQuery.findMethodByToken(userId, token);
        if (raced) return { created: false, data: toView(raced) };
      }
      if (isUniqueViolation(error, "saved_method_default") || isUniqueViolation(error, "defaultKey")) {
        throw new CustomException("Your default payment method changed at the same moment. Please try again.", conflict);
      }
      throw error;
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (user: RequestUser, id: string) => {
  try {
    const userId = customerUserId(user);
    const methodId = idOrNotFound(id, NOT_FOUND);
    await CustomerPaymentQuery.inTransaction(async (tx) => {
      const { found, wasDefault } = await CustomerPaymentQuery.deleteMethod(userId, methodId, tx);
      if (!found) throw new CustomException(NOT_FOUND, notFound);
      // Removing the default hands the role to the newest remaining method.
      if (wasDefault) await CustomerPaymentQuery.promoteNewest(userId, tx);
    });
    return { removed: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const PaymentMethodService = { listMine, add, remove };
