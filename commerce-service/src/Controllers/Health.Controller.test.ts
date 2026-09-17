import { Request, Response } from "express";

// Factory-mocked so this never constructs the real Sequelize instance
// (which would need DB_* env vars) or touches a real database.
jest.mock("../DB/Sequelize.Connection.Db.js", () => ({
  sequelize: { authenticate: jest.fn() },
}));

import { sequelize } from "../DB/Sequelize.Connection.Db.js";
import { HealthController } from "./Health.Controller.js";

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("HealthController.check", () => {
  it("returns 200 when the database is reachable", async () => {
    (sequelize.authenticate as jest.Mock).mockResolvedValue(undefined);
    const res = mockRes();

    await HealthController.check({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: true }));
  });

  it("returns 503, not a blind 200, when the database is unreachable", async () => {
    (sequelize.authenticate as jest.Mock).mockRejectedValue(new Error("connection refused"));
    const res = mockRes();

    await HealthController.check({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: false }));
  });
});
