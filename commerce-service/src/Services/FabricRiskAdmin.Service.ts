import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { conflict, notFound } from "../../commons/Utils/StatusCode.js";
import type { IFabricRuleView } from "../Models/StoreAdmin/StoreAdmin.Interface.js";
import { isUniqueViolation } from "../Queries/DatabaseError.js";
import { FabricRiskAdminQuery, IFabricRuleChange } from "../Queries/FabricRiskAdmin.Query.js";
import { oneOf, optionalText, parseBody } from "../Utils/Input.js";
import { isUuid } from "../Utils/Uuid.js";

export const FABRICS = ["cotton", "linen", "wool", "silk", "synthetic", "blend", "denim", "leather", "unknown"] as const;
export const RISKS = ["low", "medium", "high"] as const;
type Risk = (typeof RISKS)[number];

const NOT_FOUND = "Fabric risk rule not found.";
const DUPLICATE = "A rule for this fabric already exists.";

// The floor's washing fields are not part of the admin contract, so a new rule starts from the
// standard programme for its risk; the floor team tunes them where they live.
const PROGRAMME: Record<Risk, { washProgramme: string; dryProgramme: string; maxTemperatureC: number; cycle: string }> = {
  low: { washProgramme: "Warm 40°C", dryProgramme: "Medium tumble", maxTemperatureC: 40, cycle: "normal" },
  medium: { washProgramme: "Gentle 30°C", dryProgramme: "Low tumble", maxTemperatureC: 30, cycle: "gentle" },
  high: { washProgramme: "Delicate cold 20°C", dryProgramme: "Flat dry", maxTemperatureC: 20, cycle: "delicate" },
};

const toView = (rule: IFabricRuleView) => ({
  id: rule.id,
  fabric: rule.fabric,
  risk: rule.risk,
  handling: rule.handling,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});

const duplicate = (error: unknown): unknown =>
  isUniqueViolation(error, "fabric") ? new CustomException(DUPLICATE, conflict) : error;

const create = async (input: unknown) => {
  try {
    const body = parseBody(input);
    const fabric = oneOf(body.fabric, FABRICS, "fabric");
    const risk = oneOf(body.risk, RISKS, "risk");
    const handling = optionalText(body.handling, "handling", 300) ?? "Standard handling.";
    try {
      return toView(await FabricRiskAdminQuery.create({ fabric, risk, handling, ...PROGRAMME[risk] }));
    } catch (error) {
      throw duplicate(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const update = async (id: string, input: unknown) => {
  try {
    const body = parseBody(input);
    const data: IFabricRuleChange = {};
    if (body.fabric !== undefined) data.fabric = oneOf(body.fabric, FABRICS, "fabric");
    if (body.risk !== undefined) data.risk = oneOf(body.risk, RISKS, "risk");
    if (body.handling !== undefined) data.handling = optionalText(body.handling, "handling", 300) ?? "Standard handling.";
    const current = isUuid(id) ? await FabricRiskAdminQuery.findById(id) : null;
    if (!current) throw new CustomException(NOT_FOUND, notFound);
    if (Object.keys(data).length === 0) return toView(current);
    try {
      return toView(await FabricRiskAdminQuery.update(id, data));
    } catch (error) {
      throw duplicate(error);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

const remove = async (id: string) => {
  try {
    if (!isUuid(id) || !(await FabricRiskAdminQuery.findById(id))) throw new CustomException(NOT_FOUND, notFound);
    await FabricRiskAdminQuery.remove(id);
    return { id, deleted: true };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const FabricRiskAdminService = { create, update, remove };
