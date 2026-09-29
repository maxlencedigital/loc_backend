import { CustomException } from "../../commons/Exception/CustomException.js";
import { OAuthService } from "./OAuth.Service.js";

// The tests that matter here are the REJECTIONS, especially aud / app_id:
// nothing on the happy path reveals if those checks stop working.

const WEB_CLIENT = "111-web.apps.googleusercontent.com";
const ANDROID_CLIENT = "222-android.apps.googleusercontent.com";
const FB_APP_ID = "fb-app-id";

const mockFetch = (...responses: Array<{ ok?: boolean; body: unknown }>) => {
  const fetchMock = jest.fn();
  for (const { ok = true, body } of responses) {
    fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
  }
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const googlePayload = (overrides: Record<string, unknown> = {}) => ({
  aud: WEB_CLIENT,
  sub: "google-sub-1",
  email: "Person@Example.com",
  email_verified: "true",
  name: "A Person",
  ...overrides,
});

describe("OAuthService.verify — Google", () => {
  beforeEach(() => {
    process.env.GOOGLE_AUTH_CLIENT_ID = WEB_CLIENT;
  });

  it("returns the identity from the token, not from anything the caller sent", async () => {
    mockFetch({ body: googlePayload() });

    const identity = await OAuthService.verify("google", "a-token");

    expect(identity).toEqual({
      provider: "google",
      subject: "google-sub-1",
      email: "person@example.com",
      name: "A Person",
      emailVerified: true,
    });
  });

  it("rejects a validly-signed token issued to a DIFFERENT application", async () => {
    mockFetch({ body: googlePayload({ aud: "someone-elses-app.apps.googleusercontent.com" }) });

    await expect(OAuthService.verify("google", "a-token")).rejects.toThrow(CustomException);
  });

  it("rejects a token with no aud at all", async () => {
    mockFetch({ body: googlePayload({ aud: undefined }) });

    await expect(OAuthService.verify("google", "a-token")).rejects.toThrow(CustomException);
  });

  it("accepts any configured client id, so the Android and iOS apps both work", async () => {
    process.env.GOOGLE_AUTH_CLIENT_ID = `${WEB_CLIENT}, ${ANDROID_CLIENT}`;
    mockFetch({ body: googlePayload({ aud: ANDROID_CLIENT }) });

    await expect(OAuthService.verify("google", "a-token")).resolves.toMatchObject({
      subject: "google-sub-1",
    });
  });

  it("treats a boolean email_verified as verified, not as unverified", async () => {
    mockFetch({ body: googlePayload({ email_verified: true }) });

    await expect(OAuthService.verify("google", "a-token")).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("reports an unverified email as unverified", async () => {
    mockFetch({ body: googlePayload({ email_verified: "false" }) });

    await expect(OAuthService.verify("google", "a-token")).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it("rejects when Google itself rejects the token", async () => {
    mockFetch({ ok: false, body: {} });

    await expect(OAuthService.verify("google", "a-token")).rejects.toThrow(CustomException);
  });

  it("fails as a server error, not a bad request, when the client id is unconfigured", async () => {
    delete process.env.GOOGLE_AUTH_CLIENT_ID;
    mockFetch({ body: googlePayload() });

    const error = await OAuthService.verify("google", "a-token").catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(500);
  });
});

describe("OAuthService.verify — Facebook", () => {
  beforeEach(() => {
    process.env.FACEBOOK_AUTH_APP_ID = FB_APP_ID;
    process.env.FACEBOOK_AUTH_APP_SECRET = "fb-secret";
  });

  it("returns the identity for a token issued to this app", async () => {
    mockFetch(
      { body: { data: { app_id: FB_APP_ID, is_valid: true, user_id: "fb-1" } } },
      { body: { id: "fb-1", name: "A Person", email: "Person@Example.com" } }
    );

    await expect(OAuthService.verify("facebook", "a-token")).resolves.toEqual({
      provider: "facebook",
      subject: "fb-1",
      email: "person@example.com",
      name: "A Person",
      emailVerified: true,
    });
  });

  it("rejects a token issued to a DIFFERENT Facebook app", async () => {
    mockFetch({ body: { data: { app_id: "another-app", is_valid: true, user_id: "fb-1" } } });

    await expect(OAuthService.verify("facebook", "a-token")).rejects.toThrow(CustomException);
  });

  it("rejects a token Facebook reports as invalid", async () => {
    mockFetch({ body: { data: { app_id: FB_APP_ID, is_valid: false, user_id: "fb-1" } } });

    await expect(OAuthService.verify("facebook", "a-token")).rejects.toThrow(CustomException);
  });

  it("gives a 400, not a crash, for a Facebook account with no email", async () => {
    mockFetch(
      { body: { data: { app_id: FB_APP_ID, is_valid: true, user_id: "fb-1" } } },
      { body: { id: "fb-1", name: "A Person" } }
    );

    const error = await OAuthService.verify("facebook", "a-token").catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(400);
  });

  it("fails as a server error when the app credentials are unconfigured", async () => {
    delete process.env.FACEBOOK_AUTH_APP_ID;
    delete process.env.FACEBOOK_AUTH_APP_SECRET;

    const error = await OAuthService.verify("facebook", "a-token").catch((caught) => caught);

    expect(error).toBeInstanceOf(CustomException);
    expect(error.errorCode).toBe(500);
  });
});

describe("OAuthService.verify — Apple and unsupported providers", () => {
  it("refuses Apple rather than accepting an unverified token", async () => {
    // Deliberate: a stub that returned an identity without verifying the
    // signature would be an authentication bypass, not a placeholder.
    await expect(OAuthService.verify("apple", "a-token")).rejects.toThrow(CustomException);
  });

  it("rejects an unknown provider", async () => {
    await expect(
      OAuthService.verify("myspace" as unknown as "google", "a-token")
    ).rejects.toThrow(CustomException);
  });

  it("rejects an empty token before calling any provider", async () => {
    const fetchMock = mockFetch({ body: {} });

    await expect(OAuthService.verify("google", "")).rejects.toThrow(CustomException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
