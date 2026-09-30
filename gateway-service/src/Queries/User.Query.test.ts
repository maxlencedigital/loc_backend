// Factory-mocked so this never builds the real Prisma client or opens a pool.
jest.mock("../DB/Prisma.Connection.Db.js", () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from "../DB/Prisma.Connection.Db.js";
import { UserQuery } from "./User.Query.js";

const db = prisma.user as unknown as {
  create: jest.Mock;
  findUnique: jest.Mock;
  findMany: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
};

describe("UserQuery", () => {
  it("normalises the email before looking it up", async () => {
    db.findUnique.mockResolvedValue(null);

    await UserQuery.findByEmail("  Person@Example.COM ");

    expect(db.findUnique).toHaveBeenCalledWith({ where: { email: "person@example.com" } });
  });

  it("re-throws the ORIGINAL error, so the service layer can tell a unique violation apart", async () => {
    // The service maps Prisma's P2002 to a 409. If this layer replaced or hid the
    // error, that mapping would silently stop working.
    const unique = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    db.create.mockRejectedValue(unique);

    await expect(UserQuery.create({} as never)).rejects.toBe(unique);
  });

  it("propagates a failed read unchanged", async () => {
    const outage = new Error("connection terminated");
    db.findUnique.mockRejectedValue(outage);

    await expect(UserQuery.findById("id-1")).rejects.toBe(outage);
  });

  it("propagates a failed write instead of reporting success", async () => {
    const gone = Object.assign(new Error("Record to update not found"), { code: "P2025" });
    db.update.mockRejectedValue(gone);

    await expect(UserQuery.setPassword("missing-id", "hash")).rejects.toBe(gone);
  });

  it("searches the given roles and store, matching text on name, email and phone", async () => {
    db.findMany.mockResolvedValue([]);

    await UserQuery.search({ roles: ["staff"], storeId: "store-1", q: " san " });

    expect(db.findMany).toHaveBeenCalledWith({
      where: {
        role: { in: ["staff"] },
        storeId: "store-1",
        OR: [
          { name: { contains: "san", mode: "insensitive" } },
          { email: { contains: "san", mode: "insensitive" } },
          { phoneNumber: { contains: "san" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  });

  it("adds no store or text condition when none is asked for", async () => {
    db.findMany.mockResolvedValue([]);

    await UserQuery.search({ roles: ["admin", "staff"] });

    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { in: ["admin", "staff"] } } })
    );
  });

  it("stamps lastLoginAt and returns the updated row", async () => {
    const updated = { id: "u1", lastLoginAt: new Date() };
    db.update.mockResolvedValue(updated);

    await expect(UserQuery.recordLogin("u1")).resolves.toBe(updated);
    expect(db.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it("counts only ACTIVE accounts of a role", async () => {
    db.count.mockResolvedValue(2);

    await expect(UserQuery.countActiveByRole("super_admin")).resolves.toBe(2);
    expect(db.count).toHaveBeenCalledWith({ where: { role: "super_admin", isActive: true } });
  });

  it("writes profile and active changes, and re-throws a failed write", async () => {
    db.update.mockResolvedValue({ id: "u1" });
    await UserQuery.updateProfile("u1", { name: "New", storeId: null });
    expect(db.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: "New", storeId: null } });

    await UserQuery.setActive("u1", false);
    expect(db.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { isActive: false } });

    const gone = Object.assign(new Error("Record to update not found"), { code: "P2025" });
    db.update.mockRejectedValue(gone);
    await expect(UserQuery.setActive("missing", true)).rejects.toBe(gone);
  });
});
