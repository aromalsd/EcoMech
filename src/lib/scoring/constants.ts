/** Single source of truth for the scoring model. Mirrored in SQL — keep both in step. */

export const W_VENDOR = 4.0;
export const W_STUDENT = 0.35;
export const GEO_BOOST = 1.4;
export const GEO_RADIUS_M = 80;

export const TAU_RUSH_MIN = 8;
export const TAU_CALM_MIN = 20;

/** Rush windows in IST, as [startMinuteOfDay, endMinuteOfDay). */
export const RUSH_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [10 * 60 + 30, 11 * 60],
  [13 * 60, 13 * 60 + 45],
  [16 * 60, 16 * 60 + 30],
];

export const K_CONF = 1.2;
export const THETA = 0.4;
export const WEIGHT_FLOOR = 0.05;

export const REP_MIN = 0.1;
export const REP_MAX = 1.5;

export const RATE_ITEM_S = 90;
export const RATE_HOUR_N = 20;

/** Reports older than this are not considered at all. */
export const LEDGER_WINDOW_MIN = 360;

export const IST_OFFSET_MIN = 5 * 60 + 30;
