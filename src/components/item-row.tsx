"use client";

import { motion } from "motion/react";
import { decayVerdict, displayState } from "@/lib/scoring";
import { istClock, minuteOfDayToClock, relativeTime, rupees } from "@/lib/format";
import { StateMark, stateColor, stateWash } from "./state-mark";
import type { BoardItem, Signal } from "@/lib/types";

export interface Rhythm {
  days: number;
  minute: number;
}

interface Props {
  item: BoardItem;
  /** Learned sell-out time, shown only once there is enough history. */
  rhythm?: Rhythm | null;
  /** Null before mount, so server and client agree on the first paint. */
  now: Date | null;
  pending: Signal | null;
  onReport: (signal: Signal) => void;
}

const ACTIONS: ReadonlyArray<{ signal: Signal; label: string }> = [
  { signal: "available", label: "Still there" },
  { signal: "low", label: "Almost gone" },
  { signal: "sold_out", label: "All gone" },
];

const SIGNAL_STATE = {
  available: "available",
  low: "low",
  sold_out: "sold_out",
} as const;

export function ItemRow({ item, rhythm, now: liveNow, pending, onReport }: Props) {
  const raw = item.state;

  // Before mount, anchor to the row's own timestamp: zero elapsed, no decay.
  const now = liveNow ?? new Date(raw?.updated_at ?? 0);

  const verdict = raw
    ? decayVerdict(
        {
          score: Number(raw.score),
          topWeight: Number(raw.top_weight),
          updatedAt: new Date(raw.updated_at),
          lastSignalAt: raw.last_signal_at ? new Date(raw.last_signal_at) : null,
        },
        now,
      )
    : { state: "unknown" as const, score: 0, confidence: 0, topWeight: 0 };

  // A count is only worth showing while it is plausibly still true.
  const vendorFresh =
    raw?.last_vendor_at != null &&
    now.getTime() - new Date(raw.last_vendor_at).getTime() < 30 * 60_000;
  const count = vendorFresh ? (raw?.last_vendor_count ?? null) : null;

  // Mirrors recompute_item_state so the server and client agree.
  const vendorIsLatest =
    raw?.last_vendor_at != null &&
    (raw.last_signal_at == null ||
      new Date(raw.last_vendor_at).getTime() >= new Date(raw.last_signal_at).getTime());

  const state = displayState({ verdict, count, vendorFresh, vendorIsLatest });

  const price = rupees(item.price_paise);
  const sellout = state === "available" && count ? istClock(raw?.est_sellout_at ?? null) : null;
  const confidencePct = Math.round(verdict.confidence * 100);

  // Prefer the live prediction; fall back to the long-run pattern.
  const usualClock = minuteOfDayToClock(rhythm?.minute);
  const hint =
    sellout != null
      ? `likely gone by ${sellout}`
      : usualClock && state !== "sold_out"
        ? `usually gone by ${usualClock}`
        : null;

  return (
    <li className="glass overflow-hidden rounded-[22px]">
      <div className="flex items-start justify-between gap-4 px-[18px] pt-[15px]">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[23px] leading-[30px] tracking-[-0.012em]">{item.name}</h3>
          <p className="mt-[3px] text-[13px] leading-[18px] text-(--color-ink-3)">
            {price ? <span className="tnum">{price}</span> : null}
            {price ? " · " : null}
            {raw?.last_signal_at ? relativeTime(raw.last_signal_at, now) : "not reported yet"}
            {hint ? ` · ${hint}` : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-[7px]">
          {count != null ? (
            <span
              className="tnum text-[30px] font-semibold leading-8 tracking-[-0.025em]"
              style={{ color: stateColor(state) }}
            >
              {count}
            </span>
          ) : null}
          <StateMark state={state} />
        </div>
      </div>

      <div className="mt-[14px] flex items-center gap-2.5 px-[18px]">
        <div
          className="h-[3px] flex-1 overflow-hidden rounded-full bg-(--color-fill)"
          role="meter"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Confidence ${confidencePct} percent`}
        >
          <motion.div
            className="h-full w-full origin-left rounded-full"
            style={{ background: stateColor(state), opacity: 0.55 }}
            initial={false}
            animate={{ scaleX: verdict.confidence }}
            transition={{ type: "spring", stiffness: 160, damping: 28 }}
          />
        </div>
        <span className="tnum shrink-0 text-[11px] tabular-nums text-(--color-ink-3)">
          {state === "unknown" ? "no signal" : `${confidencePct}%`}
        </span>
      </div>

      <div className="mt-[14px] flex gap-[7px] border-t-[0.5px] border-(--color-separator) px-[14px] py-[13px]">
        {ACTIONS.map((action) => {
          const tone = SIGNAL_STATE[action.signal];
          return (
            <button
              key={action.signal}
              type="button"
              onClick={() => onReport(action.signal)}
              disabled={pending !== null}
              style={{ background: stateWash(tone), color: stateColor(tone) }}
              className="h-[38px] flex-1 rounded-full text-[13px] font-semibold shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.05)] transition-[transform,filter] duration-100 active:scale-[0.96] active:brightness-[0.94] disabled:opacity-45"
            >
              {pending === action.signal ? "…" : action.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}
