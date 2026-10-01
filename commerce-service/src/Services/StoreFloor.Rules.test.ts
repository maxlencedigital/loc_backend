import type { IFabricRule, IPiece } from "../Models/StoreFloor/StoreFloor.Interface.js";
import { assertCompatible, batchStageFor, compatibilityKey } from "./BatchCompatibility.js";
import { differsFromSuggestion, suggestProcess } from "./ProcessSuggestion.js";

const rule = (fabric: string, risk: IFabricRule["risk"], wash: string, dry: string, temp: number, cycle: string): IFabricRule => ({
  id: fabric,
  fabric,
  risk,
  handling: `${fabric} handling`,
  washProgramme: wash,
  dryProgramme: dry,
  maxTemperatureC: temp,
  cycle,
});

const COTTON = rule("cotton", "low", "Warm cotton 40°C", "Medium tumble", 40, "normal");
const WOOL = rule("wool", "high", "Wool cycle 20°C", "Flat dry", 20, "wool");
const LEATHER = rule("leather", "high", "Specialist leather care", "none", 0, "none");

const input = (over: Partial<Parameters<typeof suggestProcess>[0]> = {}) => ({
  fabric: "cotton",
  colour: "white" as const,
  soilLevel: "normal" as const,
  riskClass: "low" as const,
  careFlags: [] as string[],
  ...over,
});

describe("process suggestion (a deterministic table)", () => {
  it("starts from the fabric rule", () => {
    const s = suggestProcess(input(), COTTON);
    expect(s.risk).toBe("low");
    expect(s.recommended).toMatchObject({ wash: "Warm cotton 40°C", dry: "Medium tumble", temperatureC: 40, cycle: "normal" });
    expect(s.reasons[0]).toMatch(/cotton/);
  });

  it("washes dark and mixed colours cool and rewrites the temperature in the programme name", () => {
    for (const colour of ["dark", "multi"] as const) {
      const s = suggestProcess(input({ colour }), COTTON);
      expect(s.recommended.temperatureC).toBe(30);
      expect(s.recommended.wash).toBe("Warm cotton 30°C");
    }
  });

  it("uses the longer cycle for heavy or stained soil, except on high-risk fabric", () => {
    expect(suggestProcess(input({ soilLevel: "heavy" }), COTTON).recommended.cycle).toBe("heavy");
    expect(suggestProcess(input({ soilLevel: "stained" }), COTTON).recommended.notes).toMatch(/Pre-treat/);
    expect(suggestProcess(input({ fabric: "wool", soilLevel: "heavy" }), WOOL).recommended.cycle).toBe("wool");
  });

  it("only ever gets gentler with care flags, whatever their spelling", () => {
    const s = suggestProcess(input({ careFlags: ["Delicate", "cold-wash", "No Tumble Dry"] }), COTTON);
    expect(s.recommended).toMatchObject({ cycle: "delicate", temperatureC: 20, dry: "Flat dry" });
    expect(suggestProcess(input({ careFlags: ["hand_wash"] }), COTTON).recommended).toMatchObject({ wash: "Hand wash", cycle: "hand" });
  });

  it("takes the higher of the fabric's risk and the booking's risk", () => {
    expect(suggestProcess(input({ riskClass: "high" }), COTTON).risk).toBe("high");
    expect(suggestProcess(input({ riskClass: "low", fabric: "wool" }), WOOL).risk).toBe("high");
  });

  it("does not machine wash or dry what the rule says is specialist care", () => {
    const s = suggestProcess(input({ fabric: "leather", careFlags: ["delicate", "hand_wash"] }), LEATHER);
    expect(s.recommended).toMatchObject({ wash: "Specialist leather care", dry: "none", temperatureC: 0, cycle: "none" });
  });

  it("falls back to the cautious unknown treatment when the rule table has no row", () => {
    const s = suggestProcess(input({ fabric: "bamboo" }), null);
    expect(s.risk).toBe("medium");
    expect(s.recommended.wash).toBe("Gentle 30°C");
  });

  it("gives the same answer for the same input", () => {
    const a = suggestProcess(input({ colour: "dark", soilLevel: "heavy", careFlags: ["delicate"] }), COTTON);
    const b = suggestProcess(input({ colour: "dark", soilLevel: "heavy", careFlags: ["delicate"] }), COTTON);
    expect(a).toEqual(b);
  });

  it("calls a choice an override when wash or dry differs (case aside) or a named temperature or cycle differs", () => {
    const s = suggestProcess(input(), COTTON);
    expect(differsFromSuggestion({ wash: "warm cotton 40°c", dry: " MEDIUM TUMBLE " }, s)).toBe(false);
    expect(differsFromSuggestion({ wash: "Warm cotton 40°C", dry: "Medium tumble", temperatureC: 40, cycle: "normal" }, s)).toBe(false);
    expect(differsFromSuggestion({ wash: "Hot wash", dry: "Medium tumble" }, s)).toBe(true);
    expect(differsFromSuggestion({ wash: "Warm cotton 40°C", dry: "Flat dry" }, s)).toBe(true);
    expect(differsFromSuggestion({ wash: "Warm cotton 40°C", dry: "Medium tumble", temperatureC: 60 }, s)).toBe(true);
    expect(differsFromSuggestion({ wash: "Warm cotton 40°C", dry: "Medium tumble", cycle: "heavy" }, s)).toBe(true);
  });
});

const piece = (over: Partial<IPiece> = {}): IPiece =>
  ({
    id: Math.random().toString(36),
    tagCode: `T-${Math.random().toString(36).slice(2, 6)}`,
    serviceId: "svc-1",
    colour: "white",
    riskClass: "low",
    stage: "sorted",
    processWash: "Warm cotton 40°C",
    processDry: "Medium tumble",
    ...over,
  }) as IPiece;

describe("batch compatibility", () => {
  it("lets white and light garments share a washing load but keeps dark and mixed apart", () => {
    expect(() => assertCompatible("washing", [piece({ colour: "white" }), piece({ colour: "light" })])).not.toThrow();
    expect(() => assertCompatible("washing", [piece({ colour: "white" }), piece({ colour: "dark" })])).toThrow(/colours/);
    expect(() => assertCompatible("washing", [piece({ colour: "dark" }), piece({ colour: "multi" })])).toThrow(/colours/);
  });

  it("keeps different services, wash programmes and high-risk fabric apart", () => {
    expect(() => assertCompatible("washing", [piece(), piece({ serviceId: "svc-2" })])).toThrow(/different services/);
    expect(() => assertCompatible("washing", [piece(), piece({ processWash: "Gentle 30°C" })])).toThrow(/wash programmes/);
    expect(() => assertCompatible("washing", [piece(), piece({ riskClass: "high" })])).toThrow(/high-risk/);
  });

  it("ignores colour when drying but still separates drying programmes", () => {
    expect(() => assertCompatible("drying", [piece({ colour: "white" }), piece({ colour: "dark" })])).not.toThrow();
    expect(() => assertCompatible("drying", [piece(), piece({ processDry: "Flat dry" })])).toThrow(/drying programmes/);
  });

  it("names the garment that does not fit", () => {
    const odd = piece({ colour: "dark", tagCode: "BLR-IND-000009" });
    expect(() => assertCompatible("washing", [piece(), odd])).toThrow(/BLR-IND-000009/);
  });

  it("matches an anchor piece when adding to an existing batch", () => {
    expect(() => assertCompatible("washing", [piece({ colour: "dark" })], piece({ colour: "white" }))).toThrow();
    expect(compatibilityKey("washing", piece())).toBe(compatibilityKey("washing", piece({ colour: "light" })));
  });

  it("picks the batch stage from where the garments are and refuses mixes", () => {
    expect(batchStageFor([piece({ stage: "sorted" }), piece({ stage: "sorted" })])).toBe("washing");
    expect(batchStageFor([piece({ stage: "drying" })])).toBe("drying");
    expect(() => batchStageFor([piece({ stage: "sorted" }), piece({ stage: "drying" })])).toThrow(/do not mix/);
    expect(() => batchStageFor([piece({ stage: "received" })])).toThrow(/cannot be batched/);
    expect(() => batchStageFor([piece({ stage: "washing" })])).toThrow(/cannot be batched/);
  });
});
