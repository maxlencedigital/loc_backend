import bcrypt from "bcrypt";
import { CustomException } from "../../commons/Exception/CustomException.js";

// Factory-mocked so this test never loads the real Query -> Model ->
// Sequelize.Connection.Db.js chain, which would otherwise require
// DB_* env vars just to import.
jest.mock("../Queries/User.Query.js", () => ({
  UserQuery: {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findById: jest.fn(),
  },
}));

import { UserQuery } from "../Queries/User.Query.js";
import { AuthService } from "./Auth.Service.js";

const mockedUserQuery = UserQuery as jest.Mocked<typeof UserQuery>;

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("AuthService.register", () => {
  it("rejects a duplicate email", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue({ id: "1" } as any);
    await expect(
      AuthService.register({ name: "A", email: "a@x.com", phoneNumber: "1", password: "pw" })
    ).rejects.toThrow(CustomException);
  });

  it("creates the user with a hashed (never plaintext) password", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    mockedUserQuery.create.mockResolvedValue({
      id: "new-id",
      email: "a@x.com",
      role: "customer",
    } as any);

    const result = await AuthService.register({
      name: "A",
      email: "a@x.com",
      phoneNumber: "1",
      password: "plaintext-pw",
    });

    expect(result).toEqual({ id: "new-id", email: "a@x.com", role: "customer" });
    const createArg = mockedUserQuery.create.mock.calls[0][0];
    expect(createArg.passwordHash).not.toBe("plaintext-pw");
    expect(await bcrypt.compare("plaintext-pw", createArg.passwordHash)).toBe(true);
  });
});

describe("AuthService.login", () => {
  it("rejects an unknown email", async () => {
    mockedUserQuery.findByEmail.mockResolvedValue(null);
    await expect(AuthService.login("nobody@x.com", "pw")).rejects.toThrow(CustomException);
  });

  it("rejects a deactivated account even with the correct password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      email: "a@x.com",
      passwordHash,
      isActive: false,
      role: "customer",
    } as any);
    await expect(AuthService.login("a@x.com", "correct-password")).rejects.toThrow(CustomException);
  });

  it("rejects the wrong password for an active account", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "customer",
    } as any);
    await expect(AuthService.login("a@x.com", "wrong-password")).rejects.toThrow(CustomException);
  });

  it("issues a token and the user summary on correct credentials", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "1",
      name: "A",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "staff",
    } as any);

    const result = await AuthService.login("a@x.com", "correct-password");

    expect(result.token).toEqual(expect.any(String));
    expect(result.user).toEqual({ id: "1", name: "A", email: "a@x.com", role: "staff" });
  });
});

describe("AuthService.verifyToken", () => {
  it("throws CustomException on a garbage token", () => {
    expect(() => AuthService.verifyToken("not-a-real-token")).toThrow(CustomException);
  });

  it("round-trips exactly what login() issued", async () => {
    const passwordHash = await bcrypt.hash("pw", 4);
    mockedUserQuery.findByEmail.mockResolvedValue({
      id: "42",
      name: "A",
      email: "a@x.com",
      passwordHash,
      isActive: true,
      role: "admin",
    } as any);

    const { token } = await AuthService.login("a@x.com", "pw");
    const decoded = AuthService.verifyToken(token);

    // jwt.verify() also returns standard "iat"/"exp" claims — only assert
    // the payload this service actually put there.
    expect(decoded).toEqual(expect.objectContaining({ userId: "42", role: "admin" }));
  });
});
