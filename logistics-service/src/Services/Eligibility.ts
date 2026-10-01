import { IRider } from "../Models/Rider/Rider.Interface.js";
import { istDateOf } from "../Utils/Dates.js";

export interface Blocker {
  code: string;
  message: string;
}

// May this rider be given jobs? Insurance is checked against the Indian calendar day,
// so a policy that ends today is still valid today. `Rider.Query.listCandidates` applies
// the same rule as a filter; the service re-checks every row it returns.
export const eligibilityBlockers = (rider: IRider, at: Date = new Date()): Blocker[] => {
  const blockers: Blocker[] = [];
  if (rider.status === "suspended") {
    blockers.push({ code: "suspended", message: "The rider is suspended." });
  } else if (rider.status !== "active") {
    blockers.push({ code: "not_active", message: "The rider is not active." });
  }
  if (!rider.userId) blockers.push({ code: "account_not_linked", message: "The rider has no login account yet." });
  if (!rider.identityVerified) blockers.push({ code: "identity_unverified", message: "Identity has not been verified." });
  if (!rider.vehicleVerified) blockers.push({ code: "vehicle_unverified", message: "The vehicle has not been verified." });
  if (!rider.insuranceValid) {
    blockers.push({ code: "insurance_invalid", message: "Vehicle insurance is not valid." });
  } else if (!rider.insuranceExpiry) {
    blockers.push({ code: "insurance_expiry_unknown", message: "Vehicle insurance has no expiry date on record." });
  } else if (istDateOf(rider.insuranceExpiry) < istDateOf(at)) {
    blockers.push({ code: "insurance_expired", message: "Vehicle insurance has expired." });
  }
  return blockers;
};

export const isEligible = (rider: IRider, at: Date = new Date()): boolean => eligibilityBlockers(rider, at).length === 0;
