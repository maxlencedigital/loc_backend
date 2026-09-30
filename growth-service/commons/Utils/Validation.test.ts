import { CustomException } from "../Exception/CustomException.js";
import { requireFields } from "./Validation.js";

const caught = (fn: () => void): CustomException => {
  try {
    fn();
  } catch (error) {
    return error as CustomException;
  }
  throw new Error("expected requireFields to throw");
};

describe("requireFields", () => {
  it("passes when every field is present", () => {
    expect(() => requireFields({ a: "x", b: 1 }, ["a", "b"])).not.toThrow();
  });

  it("accepts 0 and false as real values", () => {
    expect(() => requireFields({ amount: 0, active: false }, ["amount", "active"])).not.toThrow();
  });

  it("throws a 400 naming the single missing field", () => {
    const error = caught(() => requireFields({ a: "x" }, ["a", "b"]));
    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(400);
    expect(error.displayMessage).toBe("b is required.");
  });

  it("names every missing field when several are absent", () => {
    const error = caught(() => requireFields({}, ["a", "b", "c"]));
    expect(error.displayMessage).toBe("a, b, c are required.");
  });

  it("treats null and an empty string as missing", () => {
    const error = caught(() => requireFields({ a: null, b: "" }, ["a", "b"]));
    expect(error.displayMessage).toBe("a, b are required.");
  });

  it("does not crash when there is no body at all", () => {
    expect(caught(() => requireFields(undefined, ["a"])).errorCode).toBe(400);
    expect(caught(() => requireFields(null, ["a"])).errorCode).toBe(400);
  });
});
