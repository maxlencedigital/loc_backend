import { Request, Response } from "express";

// Factory-mocked so this never constructs the real Prisma client (which would
// need DATABASE_URL / DB_* env vars) or opens a connection pool.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: { $queryRaw: jest.fn() },
}));

import { prisma } from "../DB/Prisma.Connection.Db.js";
import { HealthController } from "./Health.Controller.js";

const queryRaw = prisma.$queryRaw as unknown as jest.Mock;

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("HealthController.check", () => {
  it("returns 200 when the database is reachable", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = mockRes();

    await HealthController.check({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
  });

  it("returns 503, not a blind 200, when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"));
    const res = mockRes();

    await HealthController.check({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
  });
});
