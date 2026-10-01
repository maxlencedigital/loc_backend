export interface Point {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Straight-line distance in km; good enough to rank riders, never used to price anything. */
export const haversineKm = (a: Point, b: Point): number => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const round1 = (value: number): number => Math.round(value * 10) / 10;

export const paiseToRupees = (paise: number): number => paise / 100;

/** Rupees as a client sends them to whole paise; rounds so 0.1 + 0.2 never leaks a fraction of a paisa. */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
