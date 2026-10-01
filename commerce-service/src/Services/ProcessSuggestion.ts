import type { Colour, RiskClass, SoilLevel } from "../Models/Order/Order.Interface.js";
import type { IFabricRule } from "../Models/StoreFloor/StoreFloor.Interface.js";

export interface ISuggestionInput {
  fabric: string;
  colour: Colour;
  soilLevel: SoilLevel;
  riskClass: RiskClass;
  careFlags: string[];
}

export interface IProcessChoice {
  wash: string;
  dry: string;
  temperatureC?: number;
  cycle?: string;
}

export interface ISuggestion {
  risk: RiskClass;
  recommended: { wash: string; dry: string; temperatureC: number; cycle: string; notes: string };
  reasons: string[];
}

// A drying programme of "none" means the garment is not machine dried (it goes straight to quality check).
export const NO_DRYING = "none";

const RISK_RANK: Record<RiskClass, number> = { low: 0, medium: 1, high: 2 };
const COOL_C = 30;
const COLD_C = 20;
const TEMPERATURE = /\d+°C/;

// Used when the rule table has no row for a fabric: the cautious "unknown" treatment.
const FALLBACK_RULE: Omit<IFabricRule, "id" | "fabric"> = {
  risk: "medium",
  handling: "Fabric not identified: handle as delicate until it is checked.",
  washProgramme: "Gentle 30°C",
  dryProgramme: "Low tumble",
  maxTemperatureC: 30,
  cycle: "gentle",
};

const higherRisk = (a: RiskClass, b: RiskClass): RiskClass => (RISK_RANK[a] >= RISK_RANK[b] ? a : b);

const flagKey = (flag: string) => flag.trim().toLowerCase().replace(/[\s-]+/g, "_");

const withTemperature = (programme: string, temperatureC: number) =>
  TEMPERATURE.test(programme) ? programme.replace(TEMPERATURE, `${temperatureC}°C`) : programme;

// Pure and ordered: the fabric rule sets the baseline, then colour, soil and the flags the
// customer or rider raised can only make the treatment gentler. The same input always gives
// the same answer, so staff can see exactly why the system suggested it.
export const suggestProcess = (input: ISuggestionInput, rule: IFabricRule | null): ISuggestion => {
  const base = rule ?? { ...FALLBACK_RULE, fabric: input.fabric };
  const reasons = [`${base.fabric}: ${base.handling}`];
  const notes: string[] = [];

  const risk = higherRisk(base.risk, input.riskClass);
  if (RISK_RANK[input.riskClass] > RISK_RANK[base.risk]) reasons.push(`The booking marked this garment ${input.riskClass} risk.`);

  let wash = base.washProgramme;
  let dry = base.dryProgramme;
  let cycle = base.cycle;
  let temperatureC = base.maxTemperatureC;
  const machineWashed = temperatureC > 0;
  const flags = new Set(input.careFlags.map(flagKey));

  if ((input.colour === "dark" || input.colour === "multi") && temperatureC > COOL_C) {
    temperatureC = COOL_C;
    reasons.push("Dark and mixed colours wash cool so the colour holds.");
  }
  if (machineWashed && (input.soilLevel === "heavy" || input.soilLevel === "stained") && risk !== "high" && cycle === "normal") {
    cycle = "heavy";
    reasons.push("Heavy soil needs the longer cycle.");
  }
  if (input.soilLevel === "stained") notes.push("Pre-treat the stains before washing.");
  if (flags.has("delicate") && machineWashed) {
    cycle = "delicate";
    reasons.push("Marked delicate.");
  }
  if (flags.has("cold_wash") && temperatureC > COLD_C) {
    temperatureC = COLD_C;
    reasons.push("Marked cold wash only.");
  }
  if (flags.has("hand_wash") && machineWashed) {
    wash = "Hand wash";
    cycle = "hand";
    reasons.push("Marked hand wash.");
  }
  if (flags.has("no_tumble_dry") && dry !== NO_DRYING) {
    dry = "Flat dry";
    reasons.push("Marked no tumble dry.");
  }

  if (wash === base.washProgramme) wash = withTemperature(wash, temperatureC);
  return { risk, recommended: { wash, dry, temperatureC, cycle, notes: notes.join(" ") }, reasons };
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A choice that differs from the suggestion needs a reason on record. Temperature and cycle
// only count when the caller named them.
export const differsFromSuggestion = (choice: IProcessChoice, suggestion: ISuggestion): boolean => {
  const rec = suggestion.recommended;
  return (
    !same(choice.wash, rec.wash) ||
    !same(choice.dry, rec.dry) ||
    (choice.temperatureC !== undefined && choice.temperatureC !== rec.temperatureC) ||
    (choice.cycle !== undefined && !same(choice.cycle, rec.cycle))
  );
};
