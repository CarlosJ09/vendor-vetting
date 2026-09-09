import { describe, expect, it } from "vitest";

import { EXPIRY_WARNING_DAYS } from "@/lib/config";

import { checkDateSanity, evaluateExplicitExpiry, evaluateImplicitExpiry } from "./freshness";

const REF = "2026-06-15";

describe("evaluateExplicitExpiry", () => {
  it("passes when the printed expiry is comfortably ahead", () => {
    const result = evaluateExplicitExpiry("2026-12-31", REF, EXPIRY_WARNING_DAYS);
    expect(result.status).toBe("pass");
  });

  it("warns inside the warning band", () => {
    const result = evaluateExplicitExpiry("2026-06-20", REF, EXPIRY_WARNING_DAYS);
    expect(result.status).toBe("warn");
    expect(result.daysRemaining).toBe(5);
  });

  it("passes on the day the warning band opens", () => {
    // Exactly `EXPIRY_WARNING_DAYS + 1` out is still outside the band.
    const result = evaluateExplicitExpiry("2026-07-01", REF, EXPIRY_WARNING_DAYS);
    expect(result.daysRemaining).toBe(16);
    expect(result.status).toBe("pass");
  });

  it("warns rather than fails on the expiry date itself", () => {
    // A document is valid through its printed expiry date, not up to it.
    const result = evaluateExplicitExpiry(REF, REF, EXPIRY_WARNING_DAYS);
    expect(result.daysRemaining).toBe(0);
    expect(result.status).toBe("warn");
  });

  it("fails the day after expiry", () => {
    const result = evaluateExplicitExpiry("2026-06-14", REF, EXPIRY_WARNING_DAYS);
    expect(result.status).toBe("fail");
    expect(result.daysRemaining).toBe(-1);
  });
});

describe("evaluateImplicitExpiry", () => {
  it("derives expiry from issue date plus the configured window", () => {
    const result = evaluateImplicitExpiry("2026-06-01", 30, REF, EXPIRY_WARNING_DAYS);
    expect(result.expiryDate).toBe("2026-07-01");
    expect(result.status).toBe("pass");
  });

  it("warns as the window closes", () => {
    const result = evaluateImplicitExpiry("2026-05-25", 30, REF, EXPIRY_WARNING_DAYS);
    expect(result.expiryDate).toBe("2026-06-24");
    expect(result.daysRemaining).toBe(9);
    expect(result.status).toBe("warn");
  });

  it("fails once the window has closed", () => {
    const result = evaluateImplicitExpiry("2026-04-01", 30, REF, EXPIRY_WARNING_DAYS);
    expect(result.status).toBe("fail");
  });

  it("respects a different window length", () => {
    // The window is a config constant, not a rule baked into the function.
    const short = evaluateImplicitExpiry("2026-06-01", 5, REF, EXPIRY_WARNING_DAYS);
    const long = evaluateImplicitExpiry("2026-06-01", 365, REF, EXPIRY_WARNING_DAYS);
    expect(short.status).toBe("fail");
    expect(long.status).toBe("pass");
  });
});

describe("checkDateSanity", () => {
  it("accepts an ordinary issue date in the past", () => {
    expect(checkDateSanity({ issued: "2026-01-10", reference: REF }).ok).toBe(true);
  });

  it("accepts an issue date of today", () => {
    expect(checkDateSanity({ issued: REF, reference: REF }).ok).toBe(true);
  });

  it("rejects an issue date in the future", () => {
    const result = checkDateSanity({ issued: "2026-07-01", reference: REF });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("issue_date_in_future");
  });

  it("rejects an expiry that precedes the issue date", () => {
    const result = checkDateSanity({
      issued: "2026-01-10",
      expires: "2025-12-01",
      reference: REF,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("expiry_before_issue");
  });

  it("accepts an expiry equal to the issue date", () => {
    const result = checkDateSanity({
      issued: "2026-01-10",
      expires: "2026-01-10",
      reference: REF,
    });
    expect(result.ok).toBe(true);
  });

  it("reports every problem at once rather than short-circuiting", () => {
    const result = checkDateSanity({
      issued: "2026-08-01",
      expires: "2026-07-01",
      reference: REF,
    });
    expect(result.problems).toEqual(
      expect.arrayContaining(["issue_date_in_future", "expiry_before_issue"]),
    );
  });
});
