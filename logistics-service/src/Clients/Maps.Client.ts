import { CustomException } from "../../commons/Exception/CustomException.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";
import { badRequest, serviceUnavailable } from "../../commons/Utils/StatusCode.js";

// The only file that talks to Google Maps: Geocoding and Directions, over plain
// HTTPS. Google answers HTTP 200 even for a rejected key or an exhausted quota; the
// verdict is the `status` field, so checking response.ok alone would miss every failure.

const API_TIMEOUT_MS = 10_000;
const apiBase = () => process.env.GOOGLE_MAPS_API_BASE || "https://maps.googleapis.com/maps/api";
// Directions takes an origin, a destination and at most 23 stops between them.
const MAX_WAYPOINTS = 25;

export interface LatLng {
  lat: number;
  lng: number;
}
export type Waypoint = LatLng | string;

export interface GeocodeResult extends LatLng {
  formattedAddress: string;
  placeId: string;
  // ROOFTOP is a street address; RANGE_INTERPOLATED, GEOMETRIC_CENTER and
  // APPROXIMATE are progressively vaguer, which matters for a pickup at a door.
  locationType: string;
  partialMatch: boolean;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  startAddress: string;
  endAddress: string;
}
export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  legs: RouteLeg[];
  // Encoded polyline of the whole route, for the rider app to draw.
  polyline: string;
  // With optimize: the order the intermediate stops should be visited in.
  waypointOrder: number[];
}

const isConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

const unavailable = () =>
  new CustomException("Location lookup is unavailable right now. Please try again.", serviceUnavailable);

const get = async <T extends { status: string; error_message?: string }>(
  path: string,
  params: Record<string, string>
): Promise<T> => {
  if (!isConfigured()) {
    console.error("[maps] GOOGLE_MAPS_API_KEY is not set.");
    throw unavailable();
  }
  // The key must travel in the query string, so the URL is never logged.
  const url = `${apiBase()}${path}?${new URLSearchParams({ ...params, key: process.env.GOOGLE_MAPS_API_KEY as string })}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (error) {
    console.error(`[maps] ${path} unreachable:`, (error as Error).name);
    throw unavailable();
  }
  const raw = await response.text();
  let data: T;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`[maps] ${path} returned non-JSON (HTTP ${response.status}).`);
    throw unavailable();
  }
  // ZERO_RESULTS / NOT_FOUND are answers about the input, not failures of the service.
  if (!response.ok || !["OK", "ZERO_RESULTS", "NOT_FOUND"].includes(data.status)) {
    console.error(`[maps] ${path} -> ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
    throw unavailable();
  }
  return data;
};

const toLocation = (waypoint: Waypoint): string => {
  if (typeof waypoint === "string") {
    if (!waypoint.trim()) throw new CustomException("A waypoint address cannot be empty.", badRequest);
    return waypoint.trim();
  }
  if (!Number.isFinite(waypoint?.lat) || !Number.isFinite(waypoint?.lng)) {
    throw new CustomException("A waypoint needs numeric lat and lng.", badRequest);
  }
  if (Math.abs(waypoint.lat) > 90 || Math.abs(waypoint.lng) > 180) {
    throw new CustomException("A waypoint latitude or longitude is out of range.", badRequest);
  }
  return `${waypoint.lat},${waypoint.lng}`;
};

/** Address to coordinates, or null when Google cannot find it. */
const geocode = async (address: string, options: { region?: string } = {}): Promise<GeocodeResult | null> => {
  try {
    if (typeof address !== "string" || !address.trim()) {
      throw new CustomException("address is required.", badRequest);
    }
    const data = await get<{
      status: string;
      results: Array<{
        formatted_address: string;
        place_id: string;
        partial_match?: boolean;
        geometry: { location: LatLng; location_type: string };
      }>;
    }>("/geocode/json", { address: address.trim(), region: options.region ?? "in" });

    const best = data.results?.[0];
    if (data.status !== "OK" || !best) return null;
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      formattedAddress: best.formatted_address,
      placeId: best.place_id,
      locationType: best.geometry.location_type,
      partialMatch: best.partial_match === true,
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

/**
 * Driving route through the waypoints in order: first is the origin, last the
 * destination. Returns null when no route exists between them.
 */
const getRoute = async (waypoints: Waypoint[], options: { optimize?: boolean } = {}): Promise<RouteResult | null> => {
  try {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new CustomException("A route needs at least an origin and a destination.", badRequest);
    }
    if (waypoints.length > MAX_WAYPOINTS) {
      throw new CustomException(`A route can have at most ${MAX_WAYPOINTS} waypoints.`, badRequest);
    }
    const points = waypoints.map(toLocation);
    const stops = points.slice(1, -1);

    const params: Record<string, string> = {
      origin: points[0],
      destination: points[points.length - 1],
      mode: "driving",
    };
    if (stops.length > 0) {
      params.waypoints = `${options.optimize ? "optimize:true|" : ""}${stops.join("|")}`;
    }

    const data = await get<{
      status: string;
      routes: Array<{
        overview_polyline: { points: string };
        waypoint_order?: number[];
        legs: Array<{
          distance: { value: number };
          duration: { value: number };
          start_address: string;
          end_address: string;
        }>;
      }>;
    }>("/directions/json", params);

    const route = data.routes?.[0];
    if (data.status !== "OK" || !route) return null;
    const legs = route.legs.map((leg) => ({
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
      startAddress: leg.start_address,
      endAddress: leg.end_address,
    }));
    return {
      distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
      durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      legs,
      polyline: route.overview_polyline.points,
      waypointOrder: route.waypoint_order ?? [],
    };
  } catch (error) {
    throw toCustomException(error);
  }
};

export const MapsClient = { isConfigured, geocode, getRoute };
