"use client";

import { motion } from "motion/react";
import { decayVerdict } from "@/lib/scoring";
import { istClock, relativeTime, rupees } from "@/lib/format";
import { StatePill, stateTone } from "./state-pill";
import type { BoardItem, Signal } from "@/lib/types";

interface Props {
  item: BoardItem;
  now: Date;
  pending: Signal | null;
  onReport: (signal: Signal) => void;
}

export function ItemCard({ item, now, pending, onReport }: Props) {
  const raw = item.state;

  // Re-derive locally so confidence visibly decays between server writes.
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

  // A vendor's count is only worth showing while it is plausibly still true.
  const vendorFresh =
    raw?.last_vendor_at != null &&
    now.getTime() - new Date(raw.last_vendor_at).getTime() < 30 * 60_000;
  const count = vendorFresh ? raw?.last_vendor_count ?? null : null;

  const tone = stateTone[verdict.state];
  const price = rupees(item.price_paise);
  const sellout = verdict.state === "available" && count ? istClock(raw?.est_sellout_at ?? null) : null;
  const confidencePct = Math.round(verdict.confidence * 100);

  return (
    <li className="rounded-2xl border border-(--color-line) bg-(--color-surface) p-4 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="mt-0.5 text-2xl leading-none">
            {item.emoji ?? "🍽"}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-semibold tracking-tight">{item.name}</h3>
            <p className="mt-0.5 text-xs text-(--color-ink-faint)">
              {price ? <span className="tnum">{price}</span> : null}
              {price ? <span aria-hidden> · </span> : null}
              {raw?.last_signal_at ? relativeTime(raw.last_signal_at, now) : "no reports yet"}
            </p>
          </div>
        </div>

        {count != null ? (
          <motion.div
            key={count}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            className="shrink-0 text-right"
          >
            <div className={`tnum text-2xl font-semibold leading-none ${tone.fg}`}>{count}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-(--color-ink-faint)">
              left
            </div>
          </motion.div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatePill state={verdict.state} />
        {sellout ? (
          <span className="text-xs text-(--color-ink-faint)">likely gone by {sellout}</span>
        ) : null}
      </div>

      {/* Confidence is shown honestly: an empty bar means we genuinely don't know. */}
      <div className="mt-3">
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-(--color-line)"
          role="meter"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Confidence ${confidencePct} percent`}
        >
          <motion.div
            className={`h-full rounded-full ${tone.dot}`}
            animate={{ width: `${confidencePct}%` }}
            transition={{ type: "spring", stiffness: 160, damping: 28 }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-(--color-ink-faint)">
          {verdict.state === "unknown"
            ? "Nobody has reported recently"
            : `${confidencePct}% confidence · ${sourceLabel(raw?.contributors ?? 0, vendorFresh)}`}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <ReportButton label="Available" onClick={() => onReport("available")} busy={pending === "available"} tone="ok" />
        <ReportButton label="Low" onClick={() => onReport("low")} busy={pending === "low"} tone="warn" />
        <ReportButton label="Sold out" onClick={() => onReport("sold_out")} busy={pending === "sold_out"} tone="bad" />
      </div>
    </li>
  );
}

/** Say where the belief came from, rather than reporting "0 reporters". */
function sourceLabel(contributors: number, vendorFresh: boolean): string {
  if (contributors > 0) return `${contributors} ${contributors === 1 ? "reporter" : "reporters"}`;
  return vendorFresh ? "counted by the shop" : "from earlier reports";
}

const BUTTON_TONE = {
  ok: "text-(--color-ok) hover:bg-(--color-ok-bg) active:bg-(--color-ok-bg)",
  warn: "text-(--color-warn) hover:bg-(--color-warn-bg) active:bg-(--color-warn-bg)",
  bad: "text-(--color-bad) hover:bg-(--color-bad-bg) active:bg-(--color-bad-bg)",
} as const;

function ReportButton({
  label,
  onClick,
  busy,
  tone,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  tone: keyof typeof BUTTON_TONE;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`min-h-11 rounded-xl border border-(--color-line) bg-transparent px-2 text-sm font-medium transition-colors disabled:opacity-50 ${BUTTON_TONE[tone]}`}
    >
      {busy ? "…" : label}
    </button>
  );
}
