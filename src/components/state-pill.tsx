import type { AvailState } from "@/lib/types";

const LABEL: Record<AvailState, string> = {
  available: "Available",
  low: "Running low",
  sold_out: "Sold out",
  uncertain: "Unclear",
  unknown: "No recent reports",
};

const TONE: Record<AvailState, { fg: string; bg: string; dot: string }> = {
  available: { fg: "text-(--color-ok)", bg: "bg-(--color-ok-bg)", dot: "bg-(--color-ok)" },
  low: { fg: "text-(--color-warn)", bg: "bg-(--color-warn-bg)", dot: "bg-(--color-warn)" },
  sold_out: { fg: "text-(--color-bad)", bg: "bg-(--color-bad-bg)", dot: "bg-(--color-bad)" },
  uncertain: { fg: "text-(--color-hazy)", bg: "bg-(--color-hazy-bg)", dot: "bg-(--color-hazy)" },
  unknown: { fg: "text-(--color-void)", bg: "bg-(--color-void-bg)", dot: "bg-(--color-void)" },
};

export function stateLabel(state: AvailState) {
  return LABEL[state];
}

export function StatePill({ state }: { state: AvailState }) {
  const tone = TONE[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone.bg} ${tone.fg}`}
    >
      <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
      {LABEL[state]}
    </span>
  );
}

export const stateTone = TONE;
