import { describe, expect, it } from "vitest";
import {
  countToSignal,
  displayState,
  decayVerdict,
  decayedWeight,
  evaluate,
  distanceMetres,
  isRushHour,
  reputationMultiplier,
  tauMinutes,
  type AvailState,
  type LedgerEntry,
  type Verdict,
} from "./index";
import { TAU_CALM_MIN, TAU_RUSH_MIN, W_STUDENT, W_VENDOR } from "./constants";

/** 2026-09-11 at a given IST wall-clock time, as a UTC instant. */
const ist = (hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 8, 11, hh, mm) - (5 * 60 + 30) * 60_000);

const ago = (from: Date, minutes: number) => new Date(from.getTime() - minutes * 60_000);

describe("time-of-day decay", () => {
  it("treats break times as rush windows", () => {
    expect(isRushHour(ist(10, 45))).toBe(true);
    expect(isRushHour(ist(13, 30))).toBe(true);
    expect(isRushHour(ist(16, 15))).toBe(true);
  });

  it("treats quiet hours as calm", () => {
    expect(isRushHour(ist(9, 0))).toBe(false);
    expect(isRushHour(ist(15, 0))).toBe(false);
  });

  it("is exclusive at the closing edge of a window", () => {
    expect(isRushHour(ist(10, 29))).toBe(false);
    expect(isRushHour(ist(10, 30))).toBe(true);
    expect(isRushHour(ist(10, 59))).toBe(true);
    expect(isRushHour(ist(11, 0))).toBe(false);
  });

  it("picks tau from the window the report was made in", () => {
    expect(tauMinutes(ist(10, 45))).toBe(TAU_RUSH_MIN);
    expect(tauMinutes(ist(15, 0))).toBe(TAU_CALM_MIN);
  });

  it("decays to 1/e after exactly one time constant", () => {
    const now = ist(15, 20);
    const entry: LedgerEntry = { signal: "available", weight: 1, at: ago(now, TAU_CALM_MIN) };
    expect(decayedWeight(entry, now)).toBeCloseTo(Math.E ** -1, 6);
  });

  it("decays a rush-hour report faster than a calm one of the same age", () => {
    const rushNow = ist(10, 50);
    const calmNow = ist(15, 10);
    const rush = decayedWeight({ signal: "available", weight: 1, at: ago(rushNow, 10) }, rushNow);
    const calm = decayedWeight({ signal: "available", weight: 1, at: ago(calmNow, 10) }, calmNow);
    expect(rush).toBeLessThan(calm);
  });
});

describe("aggregation", () => {
  it("reports unknown with an empty ledger", () => {
    const v = evaluate([], ist(15, 0));
    expect(v.state).toBe("unknown");
    expect(v.confidence).toBe(0);
  });

  it("never reports non-zero confidence while unknown", () => {
    const now = ist(15, 0);
    // Old enough that every surviving weight is below the floor.
    const v = evaluate([{ signal: "available", weight: W_VENDOR, at: ago(now, 120) }], now);
    expect(v.state).toBe("unknown");
    expect(v.confidence).toBe(0);
  });

  it("trusts a fresh vendor count over a stale crowd", () => {
    const now = ist(15, 0);
    const v = evaluate(
      [
        { signal: "sold_out", weight: W_VENDOR, at: ago(now, 1) },
        { signal: "available", weight: W_STUDENT, at: ago(now, 40) },
      ],
      now,
    );
    expect(v.state).toBe("sold_out");
  });

  it("falls to uncertain when fresh reports contradict each other", () => {
    const now = ist(15, 0);
    const v = evaluate(
      [
        { signal: "available", weight: W_STUDENT, at: ago(now, 1) },
        { signal: "sold_out", weight: W_STUDENT, at: ago(now, 1) },
      ],
      now,
    );
    expect(v.state).toBe("uncertain");
    expect(Math.abs(v.score)).toBeLessThan(0.4);
  });

  it("builds confidence as independent reports agree", () => {
    const now = ist(15, 0);
    const one = evaluate([{ signal: "available", weight: W_STUDENT, at: ago(now, 1) }], now);
    const four = evaluate(
      Array.from({ length: 4 }, () => ({
        signal: "available" as const,
        weight: W_STUDENT,
        at: ago(now, 1),
      })),
      now,
    );
    expect(four.confidence).toBeGreaterThan(one.confidence);
  });

  it("keeps confidence bounded below 1", () => {
    const now = ist(15, 0);
    const v = evaluate(
      Array.from({ length: 200 }, () => ({
        signal: "available" as const,
        weight: W_VENDOR,
        at: ago(now, 0),
      })),
      now,
    );
    expect(v.confidence).toBeLessThan(1);
    expect(v.confidence).toBeGreaterThan(0.9);
  });

  it("decays a stale consensus from available through to unknown", () => {
    const at = ist(15, 0);
    const ledger: LedgerEntry[] = [{ signal: "available", weight: W_VENDOR, at }];
    expect(evaluate(ledger, at).state).toBe("available");
    expect(evaluate(ledger, new Date(at.getTime() + 60 * 60_000)).state).toBe("uncertain");
    expect(evaluate(ledger, new Date(at.getTime() + 100 * 60_000)).state).toBe("unknown");
  });

  it("ignores reports beyond the ledger window", () => {
    const now = ist(15, 0);
    expect(evaluate([{ signal: "available", weight: 50, at: ago(now, 400) }], now).state).toBe(
      "unknown",
    );
  });
});

describe("reputation", () => {
  it("is neutral at the seeded prior", () => {
    expect(reputationMultiplier(2, 2)).toBeCloseTo(1, 6);
  });

  it("rewards a consistently accurate device", () => {
    expect(reputationMultiplier(20, 2)).toBeGreaterThan(1);
  });

  it("collapses a liar's influence toward the floor", () => {
    expect(reputationMultiplier(2, 200)).toBeCloseTo(0.1, 6);
  });

  it("stays within clamp bounds under any input", () => {
    for (const [a, b] of [[0, 0], [1e6, 1], [1, 1e6], [0.001, 0.001]]) {
      const m = reputationMultiplier(a, b);
      expect(m).toBeGreaterThanOrEqual(0.1);
      expect(m).toBeLessThanOrEqual(1.5);
    }
  });

  it("weights a troll's report low enough not to flip a healthy consensus", () => {
    const now = ist(15, 0);
    const troll = W_STUDENT * reputationMultiplier(2, 200);
    const v = evaluate(
      [
        { signal: "available", weight: W_STUDENT, at: ago(now, 2) },
        { signal: "available", weight: W_STUDENT, at: ago(now, 2) },
        { signal: "sold_out", weight: troll, at: ago(now, 0) },
      ],
      now,
    );
    expect(v.state).toBe("available");
  });
});

describe("vendor counts", () => {
  it("maps counts to signals", () => {
    expect(countToSignal(0)).toBe("sold_out");
    expect(countToSignal(-1)).toBe("sold_out");
    expect(countToSignal(1)).toBe("low");
    expect(countToSignal(2)).toBe("low");
    expect(countToSignal(3)).toBe("available");
  });
});

describe("client-side decay", () => {
  it("agrees with a full re-evaluation of the same ledger", () => {
    const at = ist(15, 0);
    const now = new Date(at.getTime() + 12 * 60_000);
    const ledger: LedgerEntry[] = [{ signal: "available", weight: W_VENDOR, at }];
    const full = evaluate(ledger, now);
    const cheap = decayVerdict(
      { score: W_VENDOR, topWeight: W_VENDOR, updatedAt: at, lastSignalAt: at },
      now,
    );
    expect(cheap.score).toBeCloseTo(full.score, 6);
    expect(cheap.state).toBe(full.state);
    expect(cheap.confidence).toBeCloseTo(full.confidence, 6);
  });

  it("goes unknown once the best evidence falls under the floor", () => {
    const at = ist(15, 0);
    const v = decayVerdict(
      { score: 1, topWeight: 1, updatedAt: at, lastSignalAt: at },
      new Date(at.getTime() + 120 * 60_000),
    );
    expect(v.state).toBe("unknown");
    expect(v.confidence).toBe(0);
  });
});

describe("what the interface reports", () => {
  const fresh = (state: AvailState, score: number): Verdict => ({
    state,
    score,
    confidence: 0.5,
    topWeight: 1,
  });

  it("shows a fresh count from the shop verbatim", () => {
    // Two left scores only +0.8, which is below the availability threshold and
    // would otherwise read as "not sure" despite being an exact count.
    expect(
      displayState({
        verdict: fresh("uncertain", 0.8),
        count: 2,
        vendorFresh: true,
        vendorIsLatest: true,
      }),
    ).toBe("low");
  });

  it("lets students override a count once they contradict it", () => {
    expect(
      displayState({
        verdict: fresh("sold_out", -2),
        count: 5,
        vendorFresh: true,
        vendorIsLatest: false,
      }),
    ).toBe("sold_out");
  });

  it("ignores a count that has gone stale", () => {
    expect(
      displayState({
        verdict: fresh("uncertain", 0.1),
        count: 5,
        vendorFresh: false,
        vendorIsLatest: true,
      }),
    ).toBe("uncertain");
  });

  it("never claims knowledge when the ledger is empty", () => {
    expect(
      displayState({
        verdict: { state: "unknown", score: 0, confidence: 0, topWeight: 0 },
        count: 5,
        vendorFresh: true,
        vendorIsLatest: true,
      }),
    ).toBe("unknown");
  });
});

describe("geofence", () => {
  it("measures a short campus distance sanely", () => {
    const a = { lat: 10.0, lng: 76.0 };
    const b = { lat: 10.0009, lng: 76.0 };
    expect(distanceMetres(a, b)).toBeGreaterThan(90);
    expect(distanceMetres(a, b)).toBeLessThan(110);
  });

  it("is zero for identical points", () => {
    expect(distanceMetres({ lat: 10, lng: 76 }, { lat: 10, lng: 76 })).toBeCloseTo(0, 6);
  });
});
