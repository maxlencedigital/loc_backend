import { Response } from "express";
import { handleSuccessResponse, handleErrorResponse } from "./Response.js";
import { CustomException } from "../Exception/CustomException.js";

const mockRes = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("handleSuccessResponse", () => {
  it("wraps the result in the standard envelope", () => {
    const res = mockRes();
    handleSuccessResponse({ statusCode: 200, result: { id: 1 } }, res, "OK");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 200,
      result: { id: 1 },
      displayMessage: "OK",
      status: true,
    });
  });

  it("defaults result to null and uses the generic success message when omitted", () => {
    const res = mockRes();
    handleSuccessResponse({ statusCode: 204 }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ result: null, status: true, displayMessage: "Operation completed successfully." })
    );
  });
});

describe("handleErrorResponse", () => {
  it("uses a CustomException's own code and message", () => {
    const res = mockRes();
    handleErrorResponse(new CustomException("Not found", 404), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 404,
      result: null,
      displayMessage: "Not found",
      status: false,
    });
  });

  it("reports any other thrown value as a generic 500 and never leaks its message", () => {
    const res = mockRes();
    handleErrorResponse(new Error("stack trace with internal file paths"), res);
    expect(res.status).toHaveBeenCalledWith(500);
    const [[body]] = (res.json as jest.Mock).mock.calls;
    expect(body.status).toBe(false);
    expect(body.displayMessage).not.toContain("internal file paths");
  });
});
