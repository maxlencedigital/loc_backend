import { CustomException } from "../../commons/Exception/CustomException.js";
import { Actor } from "../Middleware/StoreScope.js";

jest.mock("../DB/Prisma.Connection.Db.js", () => ({ prisma: {} }));
jest.mock("../Queries/Job.Query.js", () => ({ JobQuery: require("../Testing/InMemoryLogistics.js").jobQuery }));
jest.mock("../Queries/Rider.Query.js", () => ({ RiderQuery: require("../Testing/InMemoryLogistics.js").riderQuery }));
jest.mock("../Queries/Earnings.Query.js", () => ({ EarningsQuery: require("../Testing/InMemoryLogistics.js").earningsQuery }));
jest.mock("../Queries/Outbox.Query.js", () => ({ OutboxQuery: require("../Testing/InMemoryLogistics.js").outboxQuery }));
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { get: jest.fn(), post: jest.fn() } }));

import { ServiceClient } from "../../commons/Http/ServiceClient.js";
import { reset, seed, state } from "../Testing/InMemoryLogistics.js";
import { HrRiderService } from "./HrRider.Service.js";
import { RiderOnboardingService } from "./RiderOnboarding.Service.js";
import { RiderShiftService } from "./RiderShift.Service.js";
import { LOCATION_MIN_INTERVAL_MS } from "./RiderShift.Service.js";

const hr: Actor = { id: "00000000-0000-4000-9000-0000000000a1", role: "hr", storeId: null, scopeStoreId: null, name: "Hema" };
const GOOD_USER = "00000000-0000-4000-9000-0000000000b1";
const OTHER_USER = "00000000-0000-4000-9000-0000000000b2";
const NOT_A_DRIVER = "00000000-0000-4000-9000-0000000000b3";
const INACTIVE_USER = "00000000-0000-4000-9000-0000000000b4";
const MISSING_USER = "00000000-0000-4000-9000-0000000000b5";
const DOWN_USER = "00000000-0000-4000-9000-0000000000b6";

const rejection = async (promise: Promise<unknown>): Promise<CustomException> => {
  try {
    await promise;
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected the call to be rejected");
};
const refused = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
  const error = await rejection(promise);
  expect(error.errorCode).toBe(status);
  if (message) expect(error.displayMessage).toMatch(message);
  return error;
};

const gatewayUsers: Record<string, unknown> = {
  [GOOD_USER]: { id: GOOD_USER, role: "driver", isActive: true },
  [OTHER_USER]: { id: OTHER_USER, role: "driver", isActive: true },
  [NOT_A_DRIVER]: { id: NOT_A_DRIVER, role: "staff", isActive: true },
  [INACTIVE_USER]: { id: INACTIVE_USER, role: "driver", isActive: false },
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  reset();
  (ServiceClient.get as jest.Mock).mockReset().mockImplementation(async (_to: string, path: string) => {
    const id = path.split("/").pop() as string;
    if (id === DOWN_USER) throw new CustomException("A connected service is unavailable right now. Please try again.", 503);
    if (!gatewayUsers[id]) throw new CustomException("User not found.", 404);
    return gatewayUsers[id];
  });
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

const application = {
  name: "Asha Devi",
  phone: "98450 12345",
  email: "Asha@Example.com",
  city: "Bengaluru",
  vehicleType: "bike",
  vehicleNumber: "ka 01 ab 1234",
  drivingLicenceNumber: "KA0120230012345",
  idType: "aadhaar",
  idNumber: "1234 5678 9012",
};
const submit = (extra: Record<string, unknown> = {}) => RiderOnboardingService.submit({ ...application, ...extra });
const upload = (id: string, uploadToken: string, type: string, fileUrl = `https://files.example.com/${type}.jpg`) =>
  RiderOnboardingService.uploadDocument(id, { uploadToken, type, fileUrl });
const allDocuments = ["id_proof", "licence", "vehicle_rc", "insurance", "photo"];
const nextMonth = () => new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);

const completeApplication = async (extra: Record<string, unknown> = {}) => {
  const created = await submit(extra);
  for (const type of allDocuments) await upload(created.applicationId, created.uploadToken, type);
  await HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: true, insuranceValid: true, insuranceExpiry: nextMonth() });
  return created;
};

// ================================================================== applying
describe("applying to ride", () => {
  it("records the application, keeps only masked numbers and a hash of the upload token", async () => {
    const created = await submit();

    expect(created.status).toBe("submitted");
    expect(created.uploadToken).toMatch(/^[0-9a-f]{64}$/);
    const stored = state.applications[0] as any;
    expect(stored).toMatchObject({
      phone: "+919845012345",
      email: "asha@example.com",
      vehicleNumber: "KA01AB1234",
      drivingLicenceMasked: "XXXXXXXXXXX2345",
      idNumberMasked: "XXXXXXXX9012",
      openPhone: "+919845012345",
    });
    expect(JSON.stringify(stored)).not.toContain(created.uploadToken);
    expect(JSON.stringify(stored)).not.toContain("1234 5678");
    expect(JSON.stringify(stored)).not.toContain("KA0120230012345");
  });

  it.each([
    ["no name", { name: undefined }],
    ["a one-letter name", { name: "A" }],
    ["no phone", { phone: undefined }],
    ["a short phone", { phone: "12345" }],
    ["an unknown vehicle", { vehicleType: "helicopter" }],
    ["an unknown id type", { idType: "library_card" }],
    ["an invalid email", { email: "not-an-email" }],
    ["a registration with symbols", { vehicleNumber: "@@@" }],
    ["no licence number", { drivingLicenceNumber: undefined }],
    ["a malformed preferred store", { preferredStoreId: "x" }],
  ])("refuses %s", async (_label, change) => {
    await refused(submit(change), 400);
    expect(state.applications).toHaveLength(0);
  });

  it("allows one live application per phone, and a new one after a rejection", async () => {
    const first = await submit();
    await refused(submit({ phone: "+91 98450 12345", name: "Someone Else" }), 409, /already in progress/);
    await HrRiderService.reject(hr, first.applicationId, { reason: "documents unreadable" });
    expect((await submit()).status).toBe("submitted");
  });

  it("two simultaneous applications from one phone leave one", async () => {
    const results = await Promise.allSettled([submit(), submit()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.applications).toHaveLength(1);
  });
});

describe("checking an application's status", () => {
  it("needs the application id and the phone it was made with", async () => {
    const created = await submit();
    expect(await RiderOnboardingService.status({ applicationId: created.applicationId, phone: "9845012345" })).toMatchObject({
      status: "submitted",
      missingDocuments: allDocuments,
    });
    await refused(RiderOnboardingService.status({ applicationId: created.applicationId, phone: "9845099999" }), 404);
    await refused(RiderOnboardingService.status({ applicationId: "00000000-0000-4000-8000-0000000fffff", phone: "9845012345" }), 404);
    await refused(RiderOnboardingService.status({ applicationId: "junk", phone: "9845012345" }), 404);
    await refused(RiderOnboardingService.status({ phone: "9845012345" }), 400);
    await refused(RiderOnboardingService.status({ applicationId: created.applicationId, phone: "nope" }), 400);
  });
});

describe("uploading documents", () => {
  it("moves the application to review once every document is in, and a re-upload replaces", async () => {
    const created = await submit();
    for (const type of allDocuments.slice(0, 4)) {
      const result = await upload(created.applicationId, created.uploadToken, type);
      expect(result.status).toBe("submitted");
    }
    expect((await RiderOnboardingService.status({ applicationId: created.applicationId, phone: "9845012345" })).missingDocuments).toEqual(["photo"]);
    const last = await upload(created.applicationId, created.uploadToken, "photo");
    expect(last).toEqual({ type: "photo", status: "under_review", missingDocuments: [] });

    await upload(created.applicationId, created.uploadToken, "photo", "https://files.example.com/better.jpg");
    expect(state.documents.filter((d) => d.type === "photo")).toHaveLength(1);
    expect(state.documents.find((d) => d.type === "photo")?.fileUrl).toBe("https://files.example.com/better.jpg");
  });

  it("treats a wrong token and a wrong id the same: not found", async () => {
    const created = await submit();
    await refused(upload(created.applicationId, "0".repeat(64), "photo"), 404);
    await refused(upload("00000000-0000-4000-8000-0000000fffff", created.uploadToken, "photo"), 404);
    await refused(upload("junk", created.uploadToken, "photo"), 404);
    expect(state.documents).toHaveLength(0);
  });

  it.each([
    ["an unknown type", { type: "selfie" }],
    ["no link", { fileUrl: undefined }],
    ["an http link", { fileUrl: "http://files.example.com/a.jpg" }],
    ["no token", { uploadToken: undefined }],
  ])("refuses %s", async (_label, change) => {
    const created = await submit();
    await refused(
      RiderOnboardingService.uploadDocument(created.applicationId, { uploadToken: created.uploadToken, type: "photo", fileUrl: "https://files.example.com/a.jpg", ...change }),
      400
    );
  });

  it("is closed once the application is decided", async () => {
    const created = await submit();
    await HrRiderService.reject(hr, created.applicationId, { reason: "no" });
    await refused(upload(created.applicationId, created.uploadToken, "photo"), 409, /closed/);
  });
});

// ====================================================================== HR review
describe("HR reviewing applications", () => {
  it("lists with filters and paging, and shows an application with masked numbers", async () => {
    const a = await submit();
    await submit({ phone: "9845000002", city: "Hyderabad" });
    expect((await HrRiderService.listApplications({})).total).toBe(2);
    expect((await HrRiderService.listApplications({ city: "hyderabad" })).items).toHaveLength(1);
    expect((await HrRiderService.listApplications({ status: "approved" })).total).toBe(0);
    expect((await HrRiderService.listApplications({ limit: "1" })).items).toHaveLength(1);
    await refused(HrRiderService.listApplications({ status: "maybe" }), 400);
    await refused(HrRiderService.listApplications({ from: "2026-02-31" }), 400);

    await upload(a.applicationId, a.uploadToken, "photo");
    const detail = await HrRiderService.getApplication(a.applicationId);
    expect(detail).toMatchObject({ idNumber: "XXXXXXXX9012", status: "submitted" });
    expect(detail.documents).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("uploadTokenHash");
    await refused(HrRiderService.getApplication("00000000-0000-4000-8000-0000000fffff"), 404);
    await refused(HrRiderService.getApplication("junk"), 404);
  });

  it("asks for documents again and returns to review when they arrive", async () => {
    const created = await completeApplication();
    expect((await HrRiderService.getApplication(created.applicationId)).status).toBe("under_review");

    await refused(HrRiderService.requestDocuments(hr, created.applicationId, { documents: [] }), 400);
    await refused(HrRiderService.requestDocuments(hr, created.applicationId, { documents: ["selfie"] }), 400);
    await HrRiderService.requestDocuments(hr, created.applicationId, { documents: ["licence", "insurance", "licence"], message: "photo was blurred" });
    expect(await RiderOnboardingService.status({ applicationId: created.applicationId, phone: "9845012345" })).toMatchObject({
      status: "documents_requested",
      missingDocuments: ["licence", "insurance"],
    });

    expect((await upload(created.applicationId, created.uploadToken, "licence")).missingDocuments).toEqual(["insurance"]);
    expect((await upload(created.applicationId, created.uploadToken, "insurance")).status).toBe("under_review");
  });

  it("records verification and refuses contradictions", async () => {
    const created = await submit();
    await refused(HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: true }), 400);
    await refused(HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: true, insuranceValid: true }), 400, /insuranceExpiry/);
    await refused(HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: true, insuranceValid: true, insuranceExpiry: "2020-01-01" }), 400, /past/);
    await refused(HrRiderService.verify(hr, created.applicationId, { identityVerified: "yes", vehicleVerified: true, insuranceValid: false }), 400);
    expect(await HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: false, insuranceValid: false })).toMatchObject({ vehicleVerified: false });
  });

  it("will not approve until documents and verification are complete", async () => {
    const created = await submit();
    const incomplete = await refused(HrRiderService.approve(hr, created.applicationId, {}), 409, /incomplete/);
    expect((incomplete.data as any).missing).toEqual(expect.arrayContaining(["document:photo", "identity", "vehicle", "insurance"]));
    expect(state.riders).toHaveLength(0);
  });

  it("approves into an inactive rider with no login yet, and says no login was created", async () => {
    const created = await completeApplication({ preferredStoreId: "11111111-1111-4111-8111-111111111101" });
    const result = await HrRiderService.approve(hr, created.applicationId, { notes: "all good" });

    expect(result).toMatchObject({ loginCreated: false, loginLinked: false });
    expect(state.riders[0]).toMatchObject({ status: "inactive", userId: null, homeStoreId: "11111111-1111-4111-8111-111111111101", name: "Asha Devi" });
    expect((await HrRiderService.getApplication(created.applicationId)).status).toBe("approved");
    expect(state.riderEvents.map((e) => e.kind)).toEqual(["approved"]);
    const eligibility = await HrRiderService.eligibility(result.riderId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["not_active", "account_not_linked"]));
  });

  it("approves into an active rider when a driver account is given, and checks it with the gateway", async () => {
    const created = await completeApplication();
    const result = await HrRiderService.approve(hr, created.applicationId, { userId: GOOD_USER, storeId: "11111111-1111-4111-8111-111111111102" });

    expect(result).toMatchObject({ loginLinked: true });
    expect(state.riders[0]).toMatchObject({ status: "active", userId: GOOD_USER, homeStoreId: "11111111-1111-4111-8111-111111111102" });
    expect((await HrRiderService.eligibility(result.riderId)).eligible).toBe(true);
  });

  it.each([
    ["an account that is not a driver", NOT_A_DRIVER, 400],
    ["an inactive account", INACTIVE_USER, 400],
    ["an account that does not exist", MISSING_USER, 400],
    ["the gateway being unreachable", DOWN_USER, 503],
  ])("refuses %s, leaving the application undecided", async (_label, userId, status) => {
    const created = await completeApplication();
    await refused(HrRiderService.approve(hr, created.applicationId, { userId }), status);
    expect(state.riders).toHaveLength(0);
    expect((await HrRiderService.getApplication(created.applicationId)).status).toBe("under_review");
  });

  it("will not link one account to two riders", async () => {
    const first = await completeApplication();
    await HrRiderService.approve(hr, first.applicationId, { userId: GOOD_USER });
    const second = await completeApplication({ phone: "9845000003" });
    await refused(HrRiderService.approve(hr, second.applicationId, { userId: GOOD_USER }), 409);
    expect(state.riders).toHaveLength(1);
    expect((await HrRiderService.getApplication(second.applicationId)).status).toBe("under_review");
  });

  it("approving twice is refused, except to link an account later", async () => {
    const created = await completeApplication();
    await HrRiderService.approve(hr, created.applicationId, {});
    await refused(HrRiderService.approve(hr, created.applicationId, {}), 409, /already approved/);

    const linked = await HrRiderService.approve(hr, created.applicationId, { userId: OTHER_USER });
    expect(linked).toMatchObject({ loginLinked: true });
    expect(state.riders[0]).toMatchObject({ userId: OTHER_USER, status: "active" });
    await refused(HrRiderService.approve(hr, created.applicationId, { userId: GOOD_USER }), 409, /already approved/);
  });

  it("two approvals at once make one rider", async () => {
    const created = await completeApplication();
    const results = await Promise.allSettled([
      HrRiderService.approve(hr, created.applicationId, {}),
      HrRiderService.approve(hr, created.applicationId, {}),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.riders).toHaveLength(1);
  });

  it("rejects with a reason, and only while undecided", async () => {
    const created = await completeApplication();
    await refused(HrRiderService.reject(hr, created.applicationId, {}), 400, /reason/);
    expect(await HrRiderService.reject(hr, created.applicationId, { reason: "licence expired" })).toEqual({ status: "rejected" });
    await refused(HrRiderService.reject(hr, created.applicationId, { reason: "again" }), 409);
    await refused(HrRiderService.approve(hr, created.applicationId, {}), 409, /rejected/);
    await refused(HrRiderService.verify(hr, created.applicationId, { identityVerified: true, vehicleVerified: true, insuranceValid: false }), 409);

    const other = await completeApplication({ phone: "9845000004" });
    await HrRiderService.approve(hr, other.applicationId, {});
    await refused(HrRiderService.reject(hr, other.applicationId, { reason: "changed my mind" }), 409);
  });

  it("does not approve on a lapsed insurance date", async () => {
    const created = await completeApplication();
    (state.applications[0] as any).insuranceExpiry = new Date(Date.now() - 3 * 86_400_000);
    await refused(HrRiderService.approve(hr, created.applicationId, {}), 409, /expired/);
  });
});

// ============================================================ suspend and eligibility
describe("suspending and reinstating a rider", () => {
  it("stops new jobs at once, leaves the jobs in hand, and reverses cleanly", async () => {
    const rider = seed.rider({ available: true });
    seed.job({ riderId: rider.id, status: "assigned" });

    await refused(HrRiderService.suspend(hr, rider.id, {}), 400, /reason/);
    expect(await HrRiderService.suspend(hr, rider.id, { reason: "unsafe riding" })).toEqual({ status: "suspended", activeJobs: 1 });
    expect(state.riders[0]).toMatchObject({ status: "suspended", available: false, suspendedReason: "unsafe riding" });
    await refused(HrRiderService.suspend(hr, rider.id, { reason: "again" }), 409, /already suspended/);
    expect((await HrRiderService.eligibility(rider.id)).blockers.map((b) => b.code)).toContain("suspended");

    expect(await HrRiderService.reinstate(hr, rider.id, { note: "retrained" })).toEqual({ status: "active" });
    expect(state.riders[0]).toMatchObject({ status: "active", suspendedReason: null });
    await refused(HrRiderService.reinstate(hr, rider.id, {}), 409, /not suspended/);
    expect(state.riderEvents.map((e) => e.kind)).toEqual(["suspended", "reinstated"]);
  });

  it("a rider with no login goes back to inactive, not active, on reinstatement", async () => {
    const rider = seed.rider({ userId: null, status: "suspended" });
    expect(await HrRiderService.reinstate(hr, rider.id, {})).toEqual({ status: "inactive" });
  });

  it("answers 404 for an unknown rider", async () => {
    await refused(HrRiderService.suspend(hr, "00000000-0000-4000-8000-0000000fffff", { reason: "x" }), 404);
    await refused(HrRiderService.eligibility("junk"), 404);
  });

  it.each([
    ["insurance has expired", { insuranceExpiry: new Date(Date.now() - 2 * 86_400_000) }, "insurance_expired"],
    ["insurance is not valid", { insuranceValid: false }, "insurance_invalid"],
    ["identity is unverified", { identityVerified: false }, "identity_unverified"],
    ["the vehicle is unverified", { vehicleVerified: false }, "vehicle_unverified"],
    ["there is no expiry on record", { insuranceExpiry: null }, "insurance_expiry_unknown"],
  ])("blocks a rider whose %s", async (_label, change, code) => {
    const rider = seed.rider(change);
    const result = await HrRiderService.eligibility(rider.id);
    expect(result.eligible).toBe(false);
    expect(result.blockers.map((b) => b.code)).toEqual([code]);
  });

  it("a policy ending today still counts as valid today", async () => {
    const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const rider = seed.rider({ insuranceExpiry: new Date(`${todayIst}T00:00:00.000Z`) });
    expect((await HrRiderService.eligibility(rider.id)).eligible).toBe(true);
  });
});

// ============================================================ shift and availability
describe("shift and availability", () => {
  const driver = (rider: { userId: string }): Actor => ({ id: rider.userId, role: "driver", storeId: null, scopeStoreId: null, name: null });

  it("shows the rider their own profile", async () => {
    const rider = seed.rider({ name: "Ravi" });
    expect(await RiderShiftService.profile(driver(rider))).toMatchObject({ id: rider.id, name: "Ravi", onShift: false, available: true });
  });

  it("starts one shift at a time, and two simultaneous starts leave one", async () => {
    const rider = seed.rider();
    const results = await Promise.allSettled([RiderShiftService.startShift(driver(rider), {}), RiderShiftService.startShift(driver(rider), {})]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.shifts).toHaveLength(1);
    await refused(RiderShiftService.startShift(driver(rider), {}), 409, /already have a shift/);
    expect((await RiderShiftService.profile(driver(rider))).onShift).toBe(true);
  });

  it("cannot start a shift, or go available, while blocked, and says why", async () => {
    const lapsed = seed.rider({ insuranceExpiry: new Date(Date.now() - 86_400_000), available: false });
    const error = await refused(RiderShiftService.startShift(driver(lapsed), {}), 409, /insurance has expired/i);
    expect((error.data as any).blockers[0].code).toBe("insurance_expired");
    await refused(RiderShiftService.setAvailability(driver(lapsed), { available: true }), 409);
    // Going unavailable is always allowed.
    expect(await RiderShiftService.setAvailability(driver(lapsed), { available: false })).toMatchObject({ available: false });
    expect(state.shifts).toHaveLength(0);
  });

  it("validates availability input and records the position it came with", async () => {
    const rider = seed.rider({ available: false });
    await refused(RiderShiftService.setAvailability(driver(rider), {}), 400);
    await refused(RiderShiftService.setAvailability(driver(rider), { available: "yes" }), 400);
    await refused(RiderShiftService.setAvailability(driver(rider), { available: true, latitude: 12.9 }), 400, /together/);
    await RiderShiftService.setAvailability(driver(rider), { available: true, latitude: 12.9, longitude: 77.5 });
    expect(state.riders[0]).toMatchObject({ available: true, lastLatitude: 12.9, lastLongitude: 77.5 });
  });

  it("takes location pings only on shift, keeps the latest only, and drops ones that come too fast", async () => {
    const rider = seed.rider();
    await refused(RiderShiftService.postLocation(driver(rider), { latitude: 12.9, longitude: 77.5 }), 409, /shift/);
    await RiderShiftService.startShift(driver(rider), {});

    expect(await RiderShiftService.postLocation(driver(rider), { latitude: 12.9, longitude: 77.5, accuracy: 8, speed: 3 })).toEqual({ recorded: true });
    expect(await RiderShiftService.postLocation(driver(rider), { latitude: 13, longitude: 77.6 })).toEqual({ recorded: false });
    expect(state.riders[0]).toMatchObject({ lastLatitude: 12.9 });
    (state.riders[0] as any).lastLocationAt = new Date(Date.now() - LOCATION_MIN_INTERVAL_MS - 1);
    expect(await RiderShiftService.postLocation(driver(rider), { latitude: 13, longitude: 77.6 })).toEqual({ recorded: true });
    expect(state.riders[0]).toMatchObject({ lastLatitude: 13 });

    await refused(RiderShiftService.postLocation(driver(rider), { latitude: 99, longitude: 77.5 }), 400);
    await refused(RiderShiftService.postLocation(driver(rider), { latitude: 12.9 }), 400);
    await refused(RiderShiftService.postLocation(driver(rider), { latitude: 12.9, longitude: 77.5, speed: -1 }), 400);
  });
});

// ================================================================== performance
describe("rider performance", () => {
  it("sums completed work per rider, with on-time share and average rating", async () => {
    const fast = seed.rider({ name: "Fast", phone: "+919800000201" });
    const slow = seed.rider({ name: "Slow", phone: "+919800000202" });
    const done = (riderId: string, extra: Record<string, unknown>) =>
      seed.job({ riderId, status: "delivered", type: "delivery", completedAt: new Date(), distanceMeters: 2000, durationMinutes: 20, ...extra });
    done(fast.id, { onTime: true });
    done(fast.id, { onTime: true });
    done(fast.id, { onTime: false, durationMinutes: 40 });
    done(slow.id, { onTime: false });
    seed.job({ riderId: fast.id, status: "failed", completedAt: null });
    state.ratings.push({ jobId: "j1", riderId: fast.id, rating: 5, createdAt: new Date() }, { jobId: "j2", riderId: fast.id, rating: 4, createdAt: new Date() });

    const { riders } = await HrRiderService.listPerformance({});
    expect(riders[0]).toEqual({ riderId: fast.id, name: "Fast", jobsCompleted: 3, onTimePct: 66.7, avgRating: 4.5, distanceKm: 6 });
    expect(riders[1]).toMatchObject({ name: "Slow", jobsCompleted: 1, onTimePct: 0, avgRating: null });

    expect(await HrRiderService.getPerformance(fast.id, {})).toEqual({ jobsCompleted: 3, avgTimeMinutes: 26.7, distanceKm: 6, onTimePct: 66.7, avgRating: 4.5 });
    await refused(HrRiderService.getPerformance("junk", {}), 404);
  });

  it("filters by store and period, and refuses a bad period", async () => {
    const rider = seed.rider();
    seed.job({ riderId: rider.id, status: "delivered", completedAt: new Date(), storeId: "11111111-1111-4111-8111-111111111102" });
    seed.job({ riderId: rider.id, status: "delivered", completedAt: new Date(Date.now() - 200 * 86_400_000) });
    expect((await HrRiderService.listPerformance({ storeId: "11111111-1111-4111-8111-111111111102" })).riders[0].jobsCompleted).toBe(1);
    expect((await HrRiderService.listPerformance({ storeId: "11111111-1111-4111-8111-111111111101" })).riders).toHaveLength(0);
    expect((await HrRiderService.listPerformance({ period: "30d" })).riders[0].jobsCompleted).toBe(1);
    expect((await HrRiderService.listPerformance({ period: "365d" })).riders[0].jobsCompleted).toBe(2);
    const month = new Date().toISOString().slice(0, 7);
    expect((await HrRiderService.listPerformance({ period: month })).riders.length).toBeLessThanOrEqual(1);
    await refused(HrRiderService.listPerformance({ period: "fortnight" }), 400);
    await refused(HrRiderService.listPerformance({ storeId: "x" }), 400);
  });
});
