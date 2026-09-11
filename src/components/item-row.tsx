"use client";

import { motion } from "motion/react";
import { decayVerdict, displayState } from "@/lib/scoring";
import { istClock, relativeTime, rupees } from "@/lib/format";
import { StateMark } from "./state-mark";
import type { BoardItem, Signal } from "@/lib/types";

interface Props {
  item: BoardItem;
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

export function ItemRow({ item, now: liveNow, pending, onReport }: Props) {
  const raw = item.state;

  // Anchoring to the row's own timestamp makes the pre-mount render a pure
  // function of the data, and yields zero elapsed time (no decay applied).
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

  // Ground truth wins until somebody reports after it. Mirrors the same rule
  // in recompute_item_state so server and client never disagree.
  const vendorIsLatest =
    raw?.last_vendor_at != null &&
    (raw.last_signal_at == null ||
      new Date(raw.last_vendor_at).getTime() >= new Date(raw.last_signal_at).getTime());

  const state = displayState({ verdict, count, vendorFresh, vendorIsLatest });

  const price = rupees(item.price_paise);
  const sellout = state === "available" && count ? istClock(raw?.est_sellout_at ?? null) : null;
  const confidencePct = Math.round(verdict.confidence * 100);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">{item.name}</h3>
          <p className="mt-px text-[13px] leading-[18px] text-(--color-ink-3)">
            {price ? <span className="tnum">{price}</span> : null}
            {price ? " · " : null}
            {raw?.last_signal_at ? relativeTime(raw.last_signal_at, now) : "not reported yet"}
            {sellout ? ` · likely gone by ${sellout}` : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {count != null ? (
            // Deliberately not animated on entry: the clock tick re-renders this
            // row every few seconds, and an entrance animation restarts with it,
            // leaving the most important number on the row faded out.
            <span className="tnum text-[26px] font-semibold leading-7 tracking-[-0.02em]">
              {count}
            </span>
          ) : null}
          <StateMark state={state} />
        </div>
      </div>

      {/* Confidence stays deliberately neutral so the state dot remains the
          only colour that carries meaning. */}
      <div className="mt-3 flex items-center gap-2.5">
        <div
          className="h-[3px] flex-1 overflow-hidden rounded-full bg-(--color-fill)"
          role="meter"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Confidence ${confidencePct} percent`}
        >
          <motion.div
            className="h-full w-full origin-left rounded-full bg-(--color-ink-3)"
            initial={false}
            animate={{ scaleX: verdict.confidence }}
            transition={{ type: "spring", stiffness: 160, damping: 28 }}
          />
        </div>
        <span className="tnum shrink-0 text-[11px] tabular-nums text-(--color-ink-3)">
          {state === "unknown" ? "no signal" : `${confidencePct}%`}
        </span>
      </div>

      {/* Full-bleed within the row and separated by hairlines, so the actions
          read as part of the list rather than as a second segmented control. */}
      <div className="-mx-4 -mb-3 mt-3 flex border-t-[0.5px] border-(--color-separator)">
        {ACTIONS.map((action, index) => (
          <button
            key={action.signal}
            type="button"
            onClick={() => onReport(action.signal)}
            disabled={pending !== null}
            className={`h-11 flex-1 text-[14px] font-medium text-(--color-ink-2) transition-colors active:bg-black/[0.04] disabled:opacity-40 ${
              index > 0 ? "border-l-[0.5px] border-(--color-separator)" : ""
            }`}
          >
            {pending === action.signal ? "…" : action.label}
          </button>
        ))}
      </div>
    </li>
  );
}
