import { createHash } from "crypto";

// There is no garment-type table yet (the admin catalogue is still a scaffold), so a garment
// type is the pair (category, garment name) a price row already carries. Its id is a UUID
// derived from that pair, so it is stable, needs no storage and can be validated from the
// price lists alone.
const NAMESPACE = "loc.garment-type.v1";

const uuidFrom = (seed: string): string => {
  const hex = createHash("sha1").update(`${NAMESPACE}|${seed}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "89ab"[parseInt(hex[16] as string, 16) % 4] as string;
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
};

export const garmentTypeIdOf = (category: string, garment: string): string =>
  uuidFrom(`type|${category}|${garment.trim().toLowerCase()}`);

export const categoryIdOf = (category: string): string => uuidFrom(`category|${category}`);
