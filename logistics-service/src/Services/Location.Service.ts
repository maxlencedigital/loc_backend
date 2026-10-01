import crypto from "crypto";
import { getOrSet } from "../../commons/Cache/Cache.js";
import { MapsClient } from "../Clients/Maps.Client.js";
import { IJob } from "../Models/Job/Job.Interface.js";
import { Point } from "../Utils/Geo.js";

// Where logistics uses Google Maps. Every call here is best effort and none can throw:
// a missing key, an exhausted quota or a slow answer must never stop a job being created,
// listed or completed. The caller gets null and carries on without coordinates or an ETA.

const GEOCODE_BUDGET_MS = 3_000;
const ROUTE_CACHE_SECONDS = 90;
// Directions allows an origin, a destination and 23 stops between them; a round trip
// uses the origin twice, so at most 22 jobs fit.
export const MAX_ROUTE_STOPS = 22;

export interface AddressParts {
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city?: string | null;
  pincode?: string | null;
}

export interface Resolved {
  latitude: number;
  longitude: number;
}

export interface RoutePlan {
  /** Job ids in the order they should be visited. */
  order: string[];
  etaMinutes: Record<string, number>;
  legMeters: Record<string, number>;
  totalMeters: number;
}

const addressText = (address: AddressParts): string =>
  [address.addressLine1, address.addressLine2, address.landmark, address.city, address.pincode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");

/** Coordinates for an address, or null. Gives up after a few seconds so a slow Google cannot stall a request. */
const resolveCoordinates = async (address: AddressParts, budgetMs: number = GEOCODE_BUDGET_MS): Promise<Resolved | null> => {
  if (!MapsClient.isConfigured()) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    const found = await Promise.race([MapsClient.geocode(addressText(address)), timeout]);
    return found ? { latitude: found.lat, longitude: found.lng } : null;
  } catch {
    // MapsClient has already logged why; the job simply goes without coordinates.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const hasCoordinates = (job: IJob): job is IJob & { latitude: number; longitude: number } =>
  job.latitude !== null && job.longitude !== null;

const near = (value: number) => value.toFixed(3);

/**
 * Drive times through a rider's jobs from where they are now. With `optimize`, Google picks
 * the best visiting order for a round trip from the rider's position (the last leg back is
 * left out of the figures). Without it, the given order is kept and cached briefly: a rider
 * app polls this, and the answer only changes when the rider or the stops move.
 */
const planRoute = async (
  riderId: string,
  origin: Point | null,
  jobs: IJob[],
  options: { optimize?: boolean } = {}
): Promise<RoutePlan | null> => {
  const stops = jobs.filter(hasCoordinates).slice(0, MAX_ROUTE_STOPS);
  if (!origin || stops.length === 0 || !MapsClient.isConfigured()) return null;

  const compute = async (): Promise<RoutePlan | null> => {
    const start = { lat: origin.latitude, lng: origin.longitude };
    const points = stops.map((job) => ({ lat: job.latitude, lng: job.longitude }));
    const route = await MapsClient.getRoute(options.optimize ? [start, ...points, start] : [start, ...points], {
      optimize: options.optimize,
    });
    if (!route) return null;

    const visit = options.optimize && route.waypointOrder.length === stops.length ? route.waypointOrder : stops.map((_, i) => i);
    const order = visit.map((index) => stops[index].id);
    const etaMinutes: Record<string, number> = {};
    const legMeters: Record<string, number> = {};
    let seconds = 0;
    let meters = 0;
    order.forEach((jobId, index) => {
      const leg = route.legs[index];
      if (!leg) return;
      seconds += leg.durationSeconds;
      meters += leg.distanceMeters;
      etaMinutes[jobId] = Math.ceil(seconds / 60);
      legMeters[jobId] = leg.distanceMeters;
    });
    return { order, etaMinutes, legMeters, totalMeters: meters };
  };

  try {
    if (options.optimize) return await compute();
    const fingerprint = crypto
      .createHash("sha1")
      .update(`${near(origin.latitude)},${near(origin.longitude)}|${stops.map((s) => `${s.id}@${s.latitude},${s.longitude}`).join("|")}`)
      .digest("hex");
    return await getOrSet(`route:${riderId}:${fingerprint}`, ROUTE_CACHE_SECONDS, compute);
  } catch {
    return null;
  }
};

export const LocationService = { resolveCoordinates, planRoute, addressText };
