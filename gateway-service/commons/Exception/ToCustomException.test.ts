import { CustomException } from "./CustomException.js";
import { toCustomException } from "./ToCustomException.js";
import { unknownErrorMessage } from "../Constant/Constants.js";

describe("toCustomException", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it("returns a CustomException untouched — same instance, code and data", () => {
    const original = new CustomException("Not found.", 404, { attemptsRemaining: 2 });

    expect(toCustomException(original)).toBe(original);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("turns an unexpected Error into a generic 500 without leaking its message", () => {
    const result = toCustomException(new Error("connection to 10.0.0.5 refused"));

    expect(result).toBeInstanceOf(CustomException);
    expect(result.errorCode).toBe(500);
    expect(result.displayMessage).toBe(unknownErrorMessage);
    expect(result.displayMessage).not.toContain("10.0.0.5");
  });

  it("logs the original error once, so nothing is lost when it is replaced", () => {
    const original = new Error("boom");

    toCustomException(original);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(original);
  });

  it("handles things that are not Errors at all", () => {
    for (const thrown of ["a string", { code: "P2002" }, null, undefined, 42]) {
      const result = toCustomException(thrown);
      expect(result).toBeInstanceOf(CustomException);
      expect(result.errorCode).toBe(500);
    }
  });
});
