import { Response, NextFunction } from "express";
import { requireInternalSecret, requireIdentity, requireRole, IdentifiedRequest } from "./Identity.js";

const mockReqRes = (headers: Record<string, string> = {}) => {
  const req = {
    header: (name: string) => headers[name],
  } as IdentifiedRequest;
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  const next = jest.fn() as NextFunction;
  return { req, res, next };
};

describe("requireInternalSecret", () => {
  const REAL_SECRET = "the-real-shared-secret";

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = REAL_SECRET;
  });

  it("rejects a request with no secret header — this is what stops someone skipping the gateway", () => {
    const { req, res, next } = mockReqRes();
    requireInternalSecret(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong/forged secret", () => {
    const { req, res, next } = mockReqRes({ "x-internal-secret": "guessed-wrong" });
    requireInternalSecret(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the request through when the secret matches", () => {
    const { req, res, next } = mockReqRes({ "x-internal-secret": REAL_SECRET });
    requireInternalSecret(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireIdentity", () => {
  it("rejects when x-user-id / x-user-role are missing", () => {
    const { req, res, next } = mockReqRes();
    requireIdentity(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the identity and calls next() when both headers are present", () => {
    const { req, res, next } = mockReqRes({ "x-user-id": "u1", "x-user-role": "staff" });
    requireIdentity(req, res, next);
    expect(req.user).toEqual({ id: "u1", role: "staff" });
    expect(next).toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("rejects when requireIdentity never ran (no req.user)", () => {
    const { req, res, next } = mockReqRes();
    requireRole("admin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a role not in the allowed list", () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: "u1", role: "customer" };
    requireRole("admin", "staff")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a role that is in the allowed list", () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: "u1", role: "staff" };
    requireRole("admin", "staff")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
