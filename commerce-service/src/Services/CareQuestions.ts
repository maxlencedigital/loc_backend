import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest } from "../../commons/Utils/StatusCode.js";
import type { Fabric } from "../Models/CustomerAccount/CustomerAccount.Interface.js";
import type { RiskClass } from "../Models/Order/Order.Interface.js";
import { parseBody } from "../Utils/Input.js";

export type QuestionType = "yes_no" | "single_choice" | "multi_choice";

export interface IQuestion {
  id: string;
  text: string;
  type: QuestionType;
  options: string[];
}

const DELICATE_ID = "delicate";
const KIND_ID = "delicate_kind";
const WASH_ID = "wash_preference";

const DELICATE: IQuestion = {
  id: DELICATE_ID,
  text: "Is anything in this order delicate or in need of special care?",
  type: "yes_no",
  options: ["yes", "no"],
};
const KIND: IQuestion = {
  id: KIND_ID,
  text: "What kind of care does it need?",
  type: "single_choice",
  options: ["Silk or fine fabric", "Wool or cashmere", "Embroidery or beadwork", "Leather or suede", "Colour may bleed", "Something else"],
};
const WASH: IQuestion = {
  id: WASH_ID,
  text: "How would you like it washed?",
  type: "single_choice",
  options: ["Cold wash", "Hand wash", "Dry clean only", "Let the store decide"],
};

const BY_ID = new Map([DELICATE, KIND, WASH].map((q) => [q.id, q]));
const MAX_ANSWERS = 10;

// The fabric a customer names maps onto the same three classes the floor already uses.
const FABRIC_RISK: Record<Fabric, RiskClass> = {
  silk: "high",
  wool: "high",
  leather: "high",
  linen: "medium",
  denim: "medium",
  blend: "medium",
  cotton: "low",
  synthetic: "low",
  unknown: "low",
};
const RANK: Record<RiskClass, number> = { low: 0, medium: 1, high: 2 };
const maxRisk = (a: RiskClass, b: RiskClass): RiskClass => (RANK[a] >= RANK[b] ? a : b);

export const openingQuestions = (): IQuestion[] => [DELICATE];

/** Answers are selections only: the question must exist and the answer must be one of its options. */
export const parseAnswers = (raw: unknown): Map<string, string> => {
  if (!Array.isArray(raw) || raw.length > MAX_ANSWERS) {
    throw new CustomException(`answers must be a list of at most ${MAX_ANSWERS} entries.`, badRequest);
  }
  const answers = new Map<string, string>();
  for (const entry of raw) {
    const { questionId, answer } = parseBody(entry);
    const question = typeof questionId === "string" ? BY_ID.get(questionId) : undefined;
    if (!question) throw new CustomException("answers contains an unknown question.", badRequest);
    if (typeof answer !== "string" || !question.options.includes(answer)) {
      throw new CustomException(`The answer to "${question.id}" must be one of: ${question.options.join(", ")}.`, badRequest);
    }
    if (answers.has(question.id)) throw new CustomException(`"${question.id}" is answered twice.`, badRequest);
    answers.set(question.id, answer);
  }
  return answers;
};

export interface ICareEvaluation {
  followUps: IQuestion[];
  flags: { delicate: boolean; coldWash: boolean; handWash: boolean };
  offerPhotoAndNote: boolean;
  complete: boolean;
  riskClass: RiskClass;
  /** Short labels for the floor, in the order they are shown. */
  labels: string[];
}

// A normal order ends after the first answer. Follow-ups appear only when the customer says
// something is delicate, one at a time, until the kind of care and the wash are chosen.
export const evaluateCare = (
  answers: Map<string, string>,
  fabrics: Fabric[],
  hasPremiumItem: boolean
): ICareEvaluation => {
  const delicateAnswer = answers.get(DELICATE_ID);
  const kind = delicateAnswer === "yes" ? answers.get(KIND_ID) : undefined;
  const wash = delicateAnswer === "yes" ? answers.get(WASH_ID) : undefined;

  const fabricRisk = fabrics.reduce<RiskClass>((risk, fabric) => maxRisk(risk, FABRIC_RISK[fabric]), "low");
  const dryCleanOnly = wash === "Dry clean only";
  const delicate = delicateAnswer === "yes" || fabricRisk === "high";
  const coldWash =
    delicate && (kind === "Silk or fine fabric" || kind === "Wool or cashmere" || kind === "Colour may bleed" || wash === "Cold wash");
  const handWash = wash === "Hand wash" || kind === "Embroidery or beadwork";

  let riskClass: RiskClass = fabricRisk;
  if (delicate) riskClass = maxRisk(riskClass, "medium");
  if (kind === "Silk or fine fabric" || kind === "Wool or cashmere" || kind === "Leather or suede" || dryCleanOnly) {
    riskClass = "high";
  }

  const followUps: IQuestion[] = [];
  if (delicateAnswer === undefined) followUps.push(DELICATE);
  else if (delicateAnswer === "yes" && !kind) followUps.push(KIND);
  else if (delicateAnswer === "yes" && !wash) followUps.push(WASH);

  const labels = [
    ...(delicate ? ["Delicate"] : []),
    ...(coldWash ? ["Cold wash only"] : []),
    ...(handWash ? ["Hand wash only"] : []),
    ...(dryCleanOnly ? ["Dry clean only"] : []),
  ];
  return {
    followUps,
    flags: { delicate, coldWash, handWash },
    offerPhotoAndNote: delicate || hasPremiumItem,
    complete: followUps.length === 0,
    riskClass,
    labels,
  };
};

const FABRIC_LABEL_MAX = 60;

/** The care object the existing order code understands (it validates and fills the rest). */
export const toCareInput = (evaluation: ICareEvaluation, fabrics: Fabric[], customerNote: string | null) => {
  const named = [...new Set(fabrics.filter((f) => f !== "unknown"))].join(", ");
  return {
    ...(named ? { fabric: named.slice(0, FABRIC_LABEL_MAX) } : {}),
    riskClass: evaluation.riskClass,
    flags: evaluation.labels,
    ...(customerNote ? { customerNote } : {}),
    ...(evaluation.flags.handWash ? { recommendedWash: "Hand wash" } : evaluation.flags.coldWash ? { recommendedWash: "Cold wash 20°C" } : {}),
  };
};
