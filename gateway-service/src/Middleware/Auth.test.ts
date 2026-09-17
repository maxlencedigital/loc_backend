import { Response, NextFunction } from "express";

// Factory-mocked so this never needs a real JWT_SECRET or DB.
jest.mock("../Services/Auth.Service.js", () => ({
  AuthService: { verifyToken: jest.fn() },
}));

import { AuthService } from "../Services/Auth.Service.js";
import { verifyToken, requireRole, AuthenticatedRequest } from "./Auth.js";
import { CustomException } from "../../commons/Exception/CustomException.js";

const mockedAuthService = AuthService as jest.Mocked<typeof AuthService>;

const mockReqRes = (headers: Record<string, string> = {}) => {
  const req = {
    header: (name: string) => headers[name],
  } as AuthenticatedRequest;
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  const next = jest.fn() as NextFunction;
  return { req, res, next };
};

describe("verifyToken", () => {
  it("rejects a request with no Authorization header", () => {
    const { req, res, next } = mockReqRes();
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't a Bearer token", () => {
    const { req, res, next } = mockReqRes({ Authorization: "Basic abc123" });
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a Bearer token that AuthService says is invalid", () => {
    mockedAuthService.verifyToken.mockImplementation(() => {
      throw new CustomException("Invalid or expired token.", 401);
    });
    const { req, res, next } = mockReqRes({ Authorization: "Bearer bad-token" });
    verifyToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the decoded identity and calls next() on a valid token", () => {
    mockedAuthService.verifyToken.mockReturnValue({ userId: "u1", role: "admin" });
    const { req, res, next } = mockReqRes({ Authorization: "Bearer good-token" });

    verifyToken(req, res, next);

    expect(req.user).toEqual({ id: "u1", role: "admin" });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  it("rejects when no identity is attached at all", () => {
    const { req, res, next } = mockReqRes();
    requireRole("admin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an authenticated user without the required role", () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: "u1", role: "customer" };
    requireRole("admin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a user whose role is in the allowed list", () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: "u1", role: "admin" };
    requireRole("admin", "staff")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("lets a super_admin through even when super_admin isn't in the allowed list", () => {
    const { req, res, next } = mockReqRes();
    req.user = { id: "u1", role: "super_admin" };
    requireRole("driver")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
