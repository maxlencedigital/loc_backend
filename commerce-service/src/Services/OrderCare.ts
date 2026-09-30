import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import { COLOURS, ICareProfile, RISK_CLASSES, SOIL_LEVELS } from "../Models/Order/Order.Interface.js";
import { oneOf, parseBody, text, wholeNumber } from "../Utils/Input.js";

const MAX_FLAGS = 10;
const MAX_PHOTOS = 20;

// What the floor should do when the booking did not say: gentle programmes for risky fabric.
const HIGH_RISK_WASH = "Wool cycle 20°C";
const HIGH_RISK_DRY = "Flat dry";
const DEFAULT_WASH = "Warm cotton 40°C";
const DEFAULT_DRY = "Medium tumble";

const optionalNote = (value: unknown, field: string): string | null =>
  value === undefined || value === null || value === "" ? null : text(value, field, 300);

// Absent care is valid (a walk-in bag has no detail yet) and becomes a neutral profile.
export const parseCare = (raw: unknown): ICareProfile => {
  const care = parseBody(raw);
  const riskClass = care.riskClass === undefined ? "low" : oneOf(care.riskClass, RISK_CLASSES, "care.riskClass");

  if (care.flags !== undefined && (!Array.isArray(care.flags) || care.flags.length > MAX_FLAGS)) {
    throw new CustomException(`care.flags must be a list of at most ${MAX_FLAGS} entries.`, badRequest);
  }
  return {
    fabric: care.fabric === undefined ? "Not specified" : text(care.fabric, "care.fabric", 60),
    colour: care.colour === undefined ? "multi" : oneOf(care.colour, COLOURS, "care.colour"),
    soilLevel: care.soilLevel === undefined ? "normal" : oneOf(care.soilLevel, SOIL_LEVELS, "care.soilLevel"),
    riskClass,
    flags: ((care.flags as unknown[] | undefined) ?? []).map((flag) => text(flag, "care.flags", 80)),
    customerNote: optionalNote(care.customerNote, "care.customerNote"),
    riderNote: optionalNote(care.riderNote, "care.riderNote"),
    photoCount: care.photoCount === undefined ? 0 : wholeNumber(care.photoCount, "care.photoCount", 0, MAX_PHOTOS),
    recommendedWash:
      care.recommendedWash === undefined
        ? riskClass === "high" ? HIGH_RISK_WASH : DEFAULT_WASH
        : text(care.recommendedWash, "care.recommendedWash", 60),
    recommendedDry:
      care.recommendedDry === undefined
        ? riskClass === "high" ? HIGH_RISK_DRY : DEFAULT_DRY
        : text(care.recommendedDry, "care.recommendedDry", 60),
  };
};
