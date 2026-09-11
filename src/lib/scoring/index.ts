import {
  IST_OFFSET_MIN,
  K_CONF,
  LEDGER_WINDOW_MIN,
  REP_MAX,
  REP_MIN,
  RUSH_WINDOWS,
  TAU_CALM_MIN,
  TAU_RUSH_MIN,
  THETA,
  WEIGHT_FLOOR,
} from "./constants";

export type Signal = "available" | "low" | "sold_out";
export type AvailState = Signal | "uncertain" | "unknown";

export interface LedgerEntry {
  signal: Signal;
  /** Weight assigned at write time: base × reputation × geo boost. */
  weight: number;
  at: Date;
}

export interface Verdict {
  state: AvailState;
  /** Signed consensus score. Positive means available, negative means sold out. */
  score: number;
  /** 0–1. Never overstates: `unknown` always reports 0. */
  confidence: number;
  /** Largest single surviving weight, i.e. how fresh the best evidence is. */
  topWeight: number;
}

export const SIGNAL_VALUE: Record<Signal, number> = {
  available: 1,
  low: 0.2,
  sold_out: -1,
};

/** Minute-of-day in IST, independent of the host machine's timezone. */
export function istMinuteOfDay(at: Date): number {
  const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return (utcMinutes + IST_OFFSET_MIN) % (24 * 60);
}

export function isRushHour(at: Date): boolean {
  const m = istMinuteOfDay(at);
  return RUSH_WINDOWS.some(([start, end]) => m >= start && m < end);
}

/**
 * Decay time constant in minutes. Stock moves far faster at break time, so a
 * report made during a rush window loses its authority much sooner.
 */
export function tauMinutes(at: Date): number {
  return isRushHour(at) ? TAU_RUSH_MIN : TAU_CALM_MIN;
}

/** Exponential freshness decay: w(t) = w₀ · e^(−Δt / τ). */
export function decayedWeight(entry: LedgerEntry, now: Date): number {
  const elapsedMin = (now.getTime() - entry.at.getTime()) / 60_000;
  if (elapsedMin < 0) return entry.weight;
  return entry.weight * Math.exp(-elapsedMin / tauMinutes(entry.at));
}

/** Map a Beta(α, β) posterior to a weight multiplier, clamped to sane bounds. */
export function reputationMultiplier(alpha: number, beta: number): number {
  const total = alpha + beta;
  if (total <= 0) return 1;
  const mean = alpha / total;
  return Math.min(REP_MAX, Math.max(REP_MIN, mean * 2));
}

/** A vendor's raw count is authoritative; translate it into a signal. */
export function countToSignal(count: number): Signal {
  if (count <= 0) return "sold_out";
  if (count <= 2) return "low";
  return "available";
}

/**
 * Collapse a ledger of signals into a single verdict.
 *
 * Pure and dependency-free so the browser can recompute it every few seconds
 * against a moving `now`, letting confidence visibly decay with no database
 * round trip. The server runs the same model in SQL on write.
 */
export function evaluate(entries: readonly LedgerEntry[], now: Date = new Date()): Verdict {
  let score = 0;
  let topWeight = 0;

  for (const entry of entries) {
    const elapsedMin = (now.getTime() - entry.at.getTime()) / 60_000;
    if (elapsedMin > LEDGER_WINDOW_MIN) continue;
    const w = decayedWeight(entry, now);
    score += w * SIGNAL_VALUE[entry.signal];
    if (w > topWeight) topWeight = w;
  }

  if (topWeight < WEIGHT_FLOOR) {
    return { state: "unknown", score: 0, confidence: 0, topWeight };
  }

  const confidence = Math.abs(score) / (Math.abs(score) + K_CONF);
  const state: AvailState =
    score > THETA ? "available" : score < -THETA ? "sold_out" : "uncertain";

  return { state, score, confidence, topWeight };
}

/**
 * Re-derive a verdict in the browser from the last server-computed state.
 *
 * The server stores score and topWeight at `updatedAt`. Between writes nothing
 * changes except elapsed time, so both terms decay by the same factor and the
 * verdict can be refreshed locally.
 */
export function decayVerdict(
  snapshot: { score: number; topWeight: number; updatedAt: Date; lastSignalAt: Date | null },
  now: Date = new Date(),
): Verdict {
  const anchor = snapshot.lastSignalAt ?? snapshot.updatedAt;
  const elapsedMin = (now.getTime() - snapshot.updatedAt.getTime()) / 60_000;
  if (elapsedMin <= 0) {
    const confidence = Math.abs(snapshot.score) / (Math.abs(snapshot.score) + K_CONF);
    const state: AvailState =
      snapshot.topWeight < WEIGHT_FLOOR
        ? "unknown"
        : snapshot.score > THETA
          ? "available"
          : snapshot.score < -THETA
            ? "sold_out"
            : "uncertain";
    return {
      state,
      score: snapshot.score,
      confidence: state === "unknown" ? 0 : confidence,
      topWeight: snapshot.topWeight,
    };
  }

  const factor = Math.exp(-elapsedMin / tauMinutes(anchor));
  const score = snapshot.score * factor;
  const topWeight = snapshot.topWeight * factor;

  if (topWeight < WEIGHT_FLOOR) {
    return { state: "unknown", score: 0, confidence: 0, topWeight };
  }

  return {
    state: score > THETA ? "available" : score < -THETA ? "sold_out" : "uncertain",
    score,
    confidence: Math.abs(score) / (Math.abs(score) + K_CONF),
    topWeight,
  };
}

/**
 * Resolve what the interface should actually say.
 *
 * A count from the shop is ground truth, so while it is fresh and nobody has
 * contradicted it since, the state comes straight from the count rather than
 * from the consensus score — otherwise "2 left" collapses into "not sure",
 * because a `low` signal is deliberately weak in the scoring model.
 */
export function displayState(input: {
  verdict: Verdict;
  count: number | null;
  vendorFresh: boolean;
  vendorIsLatest: boolean;
}): AvailState {
  const { verdict, count, vendorFresh, vendorIsLatest } = input;
  if (verdict.state === "unknown") return "unknown";
  if (count != null && vendorFresh && vendorIsLatest) return countToSignal(count);
  return verdict.state;
}

/** Great-circle distance in metres, for the geolocation weight boost. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
