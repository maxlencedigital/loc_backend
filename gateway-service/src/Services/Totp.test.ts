import { base32Encode, currentStep, hotp, matchStep, otpauthUrl, generateSecret } from "./Totp.js";

// RFC 4226 appendix D: secret "12345678901234567890", counters 0..9.
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC4226 = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

describe("hotp (RFC 4226)", () => {
  it.each(RFC4226.map((code, counter) => [counter, code]))("counter %i gives %s", (counter, code) => {
    expect(hotp(RFC_SECRET, counter as number)).toBe(code);
  });
});

describe("totp (RFC 6238, SHA-1)", () => {
  // Appendix B, last 6 digits of the 8-digit vectors: T=59s, 1111111109s, 1234567890s, 2000000000s.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at unix time %i the code is %s", (seconds, code) => {
    expect(hotp(RFC_SECRET, currentStep(seconds * 1000))).toBe(code);
  });
});

describe("matchStep", () => {
  const nowMs = 1_700_000_000_000;
  const step = currentStep(nowMs);

  it("accepts the current step and one step of clock skew either way, and says which step matched", () => {
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step), nowMs)).toBe(step);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 1), nowMs)).toBe(step - 1);
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 1), nowMs)).toBe(step + 1);
  });

  it("refuses codes two steps away and codes that are simply wrong", () => {
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step - 2), nowMs)).toBeNull();
    expect(matchStep(RFC_SECRET, hotp(RFC_SECRET, step + 2), nowMs)).toBeNull();
    expect(matchStep(RFC_SECRET, "000000", nowMs)).toBeNull();
    expect(matchStep(RFC_SECRET, "12345", nowMs)).toBeNull();
    expect(matchStep(RFC_SECRET, "", nowMs)).toBeNull();
  });

  it("does not accept the code of another secret", () => {
    const other = generateSecret();
    expect(matchStep(RFC_SECRET, hotp(other, step), nowMs)).toBeNull();
  });
});

describe("base32 and the provisioning URL", () => {
  it("encodes per RFC 4648 (no padding)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("builds an otpauth URL authenticator apps understand", () => {
    const url = new URL(otpauthUrl(RFC_SECRET, "meera@loc.test", "LOC"));
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/LOC:meera@loc.test");
    expect(url.searchParams.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(url.searchParams.get("issuer")).toBe("LOC");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });

  it("generates a 160-bit random secret each time", () => {
    const a = generateSecret();
    expect(a).toHaveLength(20);
    expect(a.equals(generateSecret())).toBe(false);
  });
});
