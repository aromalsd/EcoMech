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

const WASH: Record<AvailState, string> = {
  available: "var(--color-ok-wash)",
  low: "var(--color-low-wash)",
  sold_out: "var(--color-bad-wash)",
  uncertain: "var(--color-hazy-wash)",
  unknown: "var(--color-void-wash)",
};

export function stateWash(state: AvailState) {
  return WASH[state];
}

export function stateLabel(state: AvailState) {
  return LABEL[state];
}

export function stateColor(state: AvailState) {
  return COLOR[state];
}

/** A tinted capsule: enough colour to read across a room, still quiet. */
export function StateMark({ state }: { state: AvailState }) {
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-full px-2.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap"
      style={{ color: COLOR[state], background: WASH[state] }}
    >
      <span
        aria-hidden
        className="size-[6px] shrink-0 rounded-full"
        style={{ background: COLOR[state] }}
      />
      {LABEL[state]}
    </span>
  );
}
