import { CustomException } from "../../commons/Exception/CustomException.js";
import { badRequest, serverError, unauthorized } from "../../commons/Utils/StatusCode.js";
import { OAuthProvider } from "../Models/User/User.Interface.js";

/**
 * Verifies a provider token SERVER-SIDE and returns the identity the provider
 * vouches for.
 *
 * The client sends only a token. It does not send its email or name — those
 * are read out of the verified token instead. Trusting a client-supplied
 * profile would mean anyone could sign in as any email by typing it in.
 */
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
    throw new CustomException(
      `${provider} login is not configured on this server.`,
      serverError
    );
  }
  return value;
};

/**
 * Google ID token. Verified against Google's own tokeninfo endpoint, which
 * checks the signature and expiry for us.
 *
 * `aud` is then checked against our own client id — this is the step that
 * matters most and is the easiest to skip: a validly-signed Google token
 * issued to a *different* application would otherwise be accepted here, so
 * anyone with any Google app could mint logins for this platform.
 */
const verifyGoogle = async (idToken: string): Promise<VerifiedOAuthIdentity> => {
  const clientId = requireEnv("GOOGLE_AUTH_CLIENT_ID", "Google");

  const response = await fetch(`${GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    throw new CustomException("Google rejected that token.", unauthorized);
  }
  const payload = (await response.json()) as Record<string, string>;

  if (payload.aud !== clientId) {
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
    emailVerified: payload.email_verified === "true",
  };
};

/**
 * Facebook user access token, checked via debug_token using an app access
 * token. debug_token is what confirms the token was issued to THIS app —
 * without that check any Facebook token would pass.
 */
const verifyFacebook = async (accessToken: string): Promise<VerifiedOAuthIdentity> => {
  const appId = requireEnv("FACEBOOK_APP_ID", "Facebook");
  const appSecret = requireEnv("FACEBOOK_APP_SECRET", "Facebook");
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
    // Facebook accounts registered by phone have no email, and the whole
    // account-matching model here keys on email.
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

/**
 * Apple is NOT implemented. Verifying Sign in with Apple properly means
 * fetching Apple's JWKS, validating the identityToken's signature against the
 * matching key, and checking iss/aud/exp — plus a Service ID, Team ID, Key ID
 * and .p8 private key that this project does not have. (Tecnogex has an
 * APPLE_CLIENT_ID but its Apple login was never actually wired up, so there's
 * no working configuration to copy either.)
 *
 * Failing loudly is deliberate: a stub that accepted tokens without verifying
 * them would be an authentication bypass.
 */
const verifyApple = async (_identityToken: string): Promise<VerifiedOAuthIdentity> => {
  throw new CustomException(
    "Apple sign-in is not available yet.",
    serverError
  );
};

const verify = async (provider: OAuthProvider, token: string): Promise<VerifiedOAuthIdentity> => {
  if (!token) throw new CustomException("A provider token is required.", badRequest);

  switch (provider) {
    case "google":
      return verifyGoogle(token);
    case "facebook":
      return verifyFacebook(token);
    case "apple":
      return verifyApple(token);
    default:
      throw new CustomException("Unsupported provider.", badRequest);
  }
};

export const OAuthService = { verify };
