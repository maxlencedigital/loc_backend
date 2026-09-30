import { CustomException } from "../../commons/Exception/CustomException.js";
import { MapsClient } from "./Maps.Client.js";

const KEY = "AIza-test-key";

const reply = (body: unknown, ok = true, status = 200) => {
  const fetchMock = jest.fn().mockResolvedValue({ ok, status, text: async () => JSON.stringify(body) });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};
const requested = (fetchMock: jest.Mock) => new URL(fetchMock.mock.calls[0][0] as string);

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected a rejection");
};

const geocodeHit = {
  status: "OK",
  results: [
    {
      formatted_address: "12 MG Road, Bengaluru, Karnataka 560001, India",
      place_id: "ChIJ-abc",
      geometry: { location: { lat: 12.9757, lng: 77.6011 }, location_type: "ROOFTOP" },
    },
  ],
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = KEY;
  delete process.env.GOOGLE_MAPS_API_BASE;
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe("MapsClient.geocode", () => {
  it("calls the Geocoding API with the address, region bias and key, and maps the result", async () => {
    const fetchMock = reply(geocodeHit);

    const result = await MapsClient.geocode("  12 MG Road, Bengaluru ");

    const url = requested(fetchMock);
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("12 MG Road, Bengaluru");
    expect(url.searchParams.get("region")).toBe("in");
    expect(url.searchParams.get("key")).toBe(KEY);
    expect(result).toEqual({
      lat: 12.9757,
      lng: 77.6011,
      formattedAddress: "12 MG Road, Bengaluru, Karnataka 560001, India",
      placeId: "ChIJ-abc",
      locationType: "ROOFTOP",
      partialMatch: false,
    });
  });

  it("flags a partial match so the caller can ask the customer to confirm", async () => {
    reply({ status: "OK", results: [{ ...geocodeHit.results[0], partial_match: true }] });

    expect((await MapsClient.geocode("MG Road"))?.partialMatch).toBe(true);
  });

  it("returns null, not an error, when the address cannot be found", async () => {
    reply({ status: "ZERO_RESULTS", results: [] });

    expect(await MapsClient.geocode("asdkjh qwe")).toBeNull();
  });

  it.each([["REQUEST_DENIED"], ["OVER_QUERY_LIMIT"], ["OVER_DAILY_LIMIT"], ["UNKNOWN_ERROR"]])(
    "treats %s (HTTP 200) as a service failure",
    async (status) => {
      reply({ status, error_message: "The provided API key is invalid." });

      const error = await rejection(MapsClient.geocode("12 MG Road"));

      expect(error.errorCode).toBe(503);
      expect(error.displayMessage).not.toContain("API key");
    }
  );

  it("never writes the API key to the log", async () => {
    reply({ status: "REQUEST_DENIED", error_message: "bad key" });

    await rejection(MapsClient.geocode("12 MG Road"));

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(KEY);
  });

  it("rejects an empty address without calling Google", async () => {
    const fetchMock = reply(geocodeHit);

    expect((await rejection(MapsClient.geocode("   "))).errorCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a network failure and a missing key as 503", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    expect((await rejection(MapsClient.geocode("12 MG Road"))).errorCode).toBe(503);

    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = reply(geocodeHit);
    expect((await rejection(MapsClient.geocode("12 MG Road"))).errorCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MapsClient.getRoute", () => {
  const directions = {
    status: "OK",
    routes: [
      {
        overview_polyline: { points: "encoded_polyline" },
        waypoint_order: [1, 0],
        legs: [
          { distance: { value: 1200 }, duration: { value: 300 }, start_address: "A", end_address: "B" },
          { distance: { value: 800 }, duration: { value: 200 }, start_address: "B", end_address: "C" },
        ],
      },
    ],
  };

  it("uses the first point as origin, the last as destination and the rest as stops", async () => {
    const fetchMock = reply(directions);

    await MapsClient.getRoute([{ lat: 12.97, lng: 77.59 }, "Indiranagar, Bengaluru", { lat: 13.0, lng: 77.6 }]);

    const url = requested(fetchMock);
    expect(url.pathname).toBe("/maps/api/directions/json");
    expect(url.searchParams.get("origin")).toBe("12.97,77.59");
    expect(url.searchParams.get("waypoints")).toBe("Indiranagar, Bengaluru");
    expect(url.searchParams.get("destination")).toBe("13,77.6");
    expect(url.searchParams.get("mode")).toBe("driving");
  });

  it("sums the legs and returns the polyline", async () => {
    reply(directions);

    const route = await MapsClient.getRoute(["A", "B", "C"]);

    expect(route).toMatchObject({ distanceMeters: 2000, durationSeconds: 500, polyline: "encoded_polyline", waypointOrder: [1, 0] });
    expect(route?.legs).toHaveLength(2);
  });

  it("asks Google to reorder the stops only when optimize is set", async () => {
    const plain = reply(directions);
    await MapsClient.getRoute(["A", "B", "C", "D"]);
    expect(requested(plain).searchParams.get("waypoints")).toBe("B|C");

    const optimised = reply(directions);
    await MapsClient.getRoute(["A", "B", "C", "D"], { optimize: true });
    expect(requested(optimised).searchParams.get("waypoints")).toBe("optimize:true|B|C");
  });

  it("omits the waypoints parameter for a direct origin-to-destination route", async () => {
    const fetchMock = reply(directions);

    await MapsClient.getRoute(["A", "B"]);

    expect(requested(fetchMock).searchParams.has("waypoints")).toBe(false);
  });

  it("returns null when there is no route", async () => {
    reply({ status: "ZERO_RESULTS", routes: [] });

    expect(await MapsClient.getRoute(["A", "B"])).toBeNull();
  });

  it("rejects bad input before calling Google", async () => {
    const fetchMock = reply(directions);
    const tooMany = Array.from({ length: 26 }, (_, i) => `stop ${i}`);

    expect((await rejection(MapsClient.getRoute(["only one"]))).errorCode).toBe(400);
    expect((await rejection(MapsClient.getRoute([] as never))).errorCode).toBe(400);
    expect((await rejection(MapsClient.getRoute(tooMany))).errorCode).toBe(400);
    expect((await rejection(MapsClient.getRoute([{ lat: 95, lng: 0 }, "B"]))).errorCode).toBe(400);
    expect((await rejection(MapsClient.getRoute([{ lat: Number.NaN, lng: 0 }, "B"]))).errorCode).toBe(400);
    expect((await rejection(MapsClient.getRoute(["A", " "]))).errorCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a quota or key failure as 503", async () => {
    reply({ status: "OVER_QUERY_LIMIT", routes: [] });

    expect((await rejection(MapsClient.getRoute(["A", "B"]))).errorCode).toBe(503);
  });
});
