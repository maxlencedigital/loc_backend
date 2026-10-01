import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, conflict } from "../../commons/Utils/StatusCode.js";
import type { Colour } from "../Models/Order/Order.Interface.js";
import type { BatchStage, IPiece, MachineType, PieceStage } from "../Models/StoreFloor/StoreFloor.Interface.js";

// A washing batch takes sorted pieces; a drying batch takes pieces the washers are done with.
export const STAGE_INTAKE: Record<BatchStage, PieceStage> = { washing: "sorted", drying: "drying" };

// Which machines may run which kind of batch. Presses and irons finish garments but do not run batches.
export const MACHINES_FOR: Record<BatchStage, MachineType[]> = {
  washing: ["washer", "other"],
  drying: ["dryer", "other"],
};

// White and light garments may share a load; dark and mixed colours each wash alone.
const colourClass = (colour: Colour) => (colour === "white" || colour === "light" ? "light" : colour);

const isHighRisk = (piece: IPiece) => piece.riskClass === "high";

// The traits that must match for two pieces to share a load. Washing keys on the wash programme and
// colour class, drying on the dry programme; a high-risk fabric never shares with ordinary laundry.
export const compatibilityKey = (stage: BatchStage, piece: IPiece): string =>
  [
    piece.serviceId,
    stage === "washing" ? (piece.processWash ?? "").toLowerCase() : (piece.processDry ?? "").toLowerCase(),
    stage === "washing" ? colourClass(piece.colour) : "",
    isHighRisk(piece) ? "high-risk" : "standard",
  ].join("|");

const mismatch = (stage: BatchStage, a: IPiece, b: IPiece): string => {
  if (a.serviceId !== b.serviceId) return "they are booked for different services";
  if (isHighRisk(a) !== isHighRisk(b)) return "a high-risk fabric cannot share a load with ordinary laundry";
  if (stage === "washing") {
    if (colourClass(a.colour) !== colourClass(b.colour)) return "their colours should not be washed together";
    return "they need different wash programmes";
  }
  return "they need different drying programmes";
};

// Every piece must be able to join the first one's load. The first mismatch is named so staff know
// which garment to take out.
export const assertCompatible = (stage: BatchStage, pieces: IPiece[], anchor?: IPiece): void => {
  const reference = anchor ?? pieces[0];
  if (!reference) return;
  const key = compatibilityKey(stage, reference);
  const odd = pieces.find((piece) => compatibilityKey(stage, piece) !== key);
  if (odd) {
    throw new CustomException(`${odd.tagCode} cannot go with ${reference.tagCode}: ${mismatch(stage, reference, odd)}.`, conflict);
  }
};

/** Picks the batch stage from where the pieces are, or explains why they cannot be batched together. */
export const batchStageFor = (pieces: IPiece[]): BatchStage => {
  const stages = new Set(pieces.map((piece) => piece.stage));
  if (stages.size === 1 && stages.has("sorted")) return "washing";
  if (stages.size === 1 && stages.has("drying")) return "drying";
  const waiting = pieces.find((piece) => piece.stage !== "sorted" && piece.stage !== "drying");
  if (waiting) {
    throw new CustomException(`${waiting.tagCode} is at ${waiting.stage.replace("_", " ")} and cannot be batched.`, conflict);
  }
  throw new CustomException("A batch is either washing or drying: do not mix sorted and washed pieces.", badRequest);
};
