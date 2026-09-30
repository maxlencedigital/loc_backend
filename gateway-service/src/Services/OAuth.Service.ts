import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, serverError, unauthorized } from "../../commons/Utils/StatusCode.js";
import { OAuthProvider } from "../Models/User/User.Interface.js";
import { toCustomException } from "../../commons/Exception/ToCustomException.js";

// Verifies a provider token SERVER-SIDE. The client sends only a token: a
// client-supplied email would let anyone sign in as any address.
export interface VerifiedOAuthIdentity {
  provider: OAuthProvider;
  /** The provider's stable user id. Preferred over email, which can change. */
  subject: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

const GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const FACEBOOK_DEBUG_TOKEN = "https://graph.facebook.com/debug_token";
const FACEBOOK_ME = "https://graph.facebook.com/me";

const requireEnv = (key: string, provider: string): string => {
  const value = process.env[key];
  if (!value) {
    // 500, not 400: the caller did nothing wrong, the server is misconfigured.
    throw new CustomException(`${provider} login is not configured on this server.`, serverError);
  }
  return value;
};

// Google's tokeninfo endpoint checks the signature and expiry; the `aud` check
// below is ours, and skipping it would accept a validly-signed token issued to
// ANY other Google app. GOOGLE_AUTH_CLIENT_ID is a comma-separated list because
// Google issues a separate client id per platform (web, Android, iOS).
const verifyGoogle = async (idToken: string): Promise<VerifiedOAuthIdentity> => {
  const clientIds = requireEnv("GOOGLE_AUTH_CLIENT_ID", "Google")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const response = await fetch(`${GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    throw new CustomException("Google rejected that token.", unauthorized);
  }
  const payload = (await response.json()) as Record<string, string>;

  if (!payload.aud || !clientIds.includes(payload.aud)) {
    throw new CustomException("That token was issued for a different application.", unauthorized);
  }
  if (!payload.sub || !payload.email) {
    throw new CustomException("Google did not return an email for that account.", unauthorized);
  }

  return {
    provider: "google",
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name ?? null,
    // tokeninfo reports this as the string "true", but other Google endpoints
    // send a real boolean; unnormalised, a boolean would read as unverified.
    emailVerified: String(payload.email_verified) === "true",
  };
};

// debug_token, called with an app access token, is what confirms the user token
// was issued to THIS app — without it any valid Facebook token would pass.
const verifyFacebook = async (accessToken: string): Promise<VerifiedOAuthIdentity> => {
  const appId = requireEnv("FACEBOOK_AUTH_APP_ID", "Facebook");
  const appSecret = requireEnv("FACEBOOK_AUTH_APP_SECRET", "Facebook");
  const appAccessToken = `${appId}|${appSecret}`;

  const debugResponse = await fetch(
    `${FACEBOOK_DEBUG_TOKEN}?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`
  );
  if (!debugResponse.ok) {
    throw new CustomException("Facebook rejected that token.", unauthorized);
  }
  const debug = (await debugResponse.json()) as {
    data?: { app_id?: string; is_valid?: boolean; user_id?: string };
  };

  if (!debug.data?.is_valid || debug.data.app_id !== appId || !debug.data.user_id) {
    throw new CustomException("That token was issued for a different application.", unauthorized);
  }

  const profileResponse = await fetch(
    `${FACEBOOK_ME}?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
  );
  const profile = (await profileResponse.json()) as { id: string; name?: string; email?: string };

  if (!profile.email) {
    // Facebook accounts registered by phone have no email, and account matching
    // here keys on email.
    throw new CustomException(
      "That Facebook account has no email address. Use another sign-in method.",
      badRequest
    );
  }

  return {
    provider: "facebook",
    subject: profile.id,
    email: profile.email.toLowerCase(),
    name: profile.name ?? null,
    // Facebook only exposes emails it has already confirmed.
    emailVerified: true,
  };
};

// Not implemented: proper verification needs Apple's JWKS plus a Service ID,
// Team ID, Key ID and .p8 key this project does not have. Fails loudly on
// purpose — a stub that accepted unverified tokens would be an auth bypass.
const verifyApple = async (_identityToken: string): Promise<VerifiedOAuthIdentity> => {
  throw new CustomException("Apple sign-in is not available yet.", serverError);
};

const verify = async (provider: OAuthProvider, token: string): Promise<VerifiedOAuthIdentity> => {
  try {
    if (!token) throw new CustomException("A provider token is required.", badRequest);

    switch (provider) {
      case "google":
        return await verifyGoogle(token);
      case "facebook":
        return await verifyFacebook(token);
      case "apple":
        return await verifyApple(token);
      default:
        throw new CustomException("Unsupported provider.", badRequest);
    }
  } catch (error) {
    throw toCustomException(error);
  }
};

export const OAuthService = { verify };
