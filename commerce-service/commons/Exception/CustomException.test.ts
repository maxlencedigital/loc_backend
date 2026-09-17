import { CustomException } from "./CustomException.js";
import { serverError } from "../Utils/StatusCode.js";

describe("CustomException", () => {
  it("is a real Error carrying the given message and status code", () => {
    const err = new CustomException("Bad input", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CustomException);
    expect(err.message).toBe("Bad input");
    expect(err.errorCode).toBe(400);
    expect(err.displayMessage).toBe("Bad input");
  });

  it("defaults to serverError when no code is given", () => {
    const err = new CustomException("Oops");
    expect(err.errorCode).toBe(serverError);
  });
});
