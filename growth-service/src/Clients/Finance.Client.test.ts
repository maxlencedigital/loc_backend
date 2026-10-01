import { CustomException } from "../../commons/Exception/CustomException.js";

const mockPost = jest.fn();
jest.mock("../../commons/Http/ServiceClient.js", () => ({ ServiceClient: { post: (...a: unknown[]) => mockPost(...a) } }));

import { FinanceClient } from "./Finance.Client.js";

const input = { orderRef: "PKG-1", amountPaise: 1000, customerUserId: "u", idempotencyKey: "PKG-1" };

beforeEach(() => {
  mockPost.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("FinanceClient.createPaymentOrder", () => {
  it("returns the checkout payload and posts the idempotency key", async () => {
    mockPost.mockResolvedValue({ paymentId: "p", razorpayOrderId: "o", amountPaise: 1000, currency: "INR", keyId: "k" });

    await expect(FinanceClient.createPaymentOrder(input)).resolves.toMatchObject({ razorpayOrderId: "o" });
    expect(mockPost).toHaveBeenCalledWith("finance", "/internal/payments/orders", { body: input, idempotent: true });
  });

  it("passes an already-paid 409 through", async () => {
    mockPost.mockRejectedValue(new CustomException("paid", 409));

    await expect(FinanceClient.createPaymentOrder(input)).rejects.toMatchObject({ errorCode: 409 });
  });

  it.each([[404], [400], [503], [500]])("turns a finance %i into a clean 503 that hides the cause", async (status) => {
    mockPost.mockRejectedValue(new CustomException("internal detail", status));

    const error = (await FinanceClient.createPaymentOrder(input).catch((e) => e)) as CustomException;

    expect(error.errorCode).toBe(503);
    expect(error.displayMessage).not.toContain("internal detail");
  });
});
