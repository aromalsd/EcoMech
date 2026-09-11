import type { AvailState } from "@/lib/types";

const LABEL: Record<AvailState, string> = {
  available: "Available",
  low: "Almost gone",
  sold_out: "Sold out",
  uncertain: "Not sure",
  unknown: "No word yet",
};

const COLOR: Record<AvailState, string> = {
  available: "var(--color-ok)",
  low: "var(--color-low)",
  sold_out: "var(--color-bad)",
  uncertain: "var(--color-hazy)",
  unknown: "var(--color-void)",
};

export function stateLabel(state: AvailState) {
  return LABEL[state];
}

export function stateColor(state: AvailState) {
  return COLOR[state];
}

/** A dot and a word. The dot is the only colour on the row. */
export function StateMark({ state }: { state: AvailState }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] text-[13px] font-medium"
      style={{ color: COLOR[state] }}
    >
      <span
        aria-hidden
        className="size-[7px] shrink-0 rounded-full"
        style={{ background: COLOR[state] }}
      />
      {LABEL[state]}
    </span>
  );
}
