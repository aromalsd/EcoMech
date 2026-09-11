import type { AvailState, Signal } from "@/lib/scoring";

export interface Shop {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  lat: number | null;
  lng: number | null;
  opens_at: string | null;
  closes_at: string | null;
  sort_order: number;
}

export interface Item {
  id: string;
  shop_id: string;
  name: string;
  emoji: string | null;
  price_paise: number | null;
  sort_order: number;
  active: boolean;
}

export interface ItemState {
  item_id: string;
  state: AvailState;
  score: number;
  confidence: number;
  top_weight: number;
  last_vendor_count: number | null;
  last_vendor_at: string | null;
  last_signal_at: string | null;
  est_sellout_at: string | null;
  contributors: number;
  updated_at: string;
}

/** An item joined with its derived state, as the board renders it. */
export interface BoardItem extends Item {
  state: ItemState | null;
}

export type SubmitResult =
  | { ok: true; weight: number; reputation: number }
  | { ok: false; reason: "rate_limited"; retry_after_s: number }
  | { ok: false; reason: "hourly_limit" | "network_limit" | "no_identity" };

export type VendorLoginResult =
  | { ok: true; token: string; shop_id: string }
  | { ok: false; reason: "locked" | "bad_pin" };

export type { AvailState, Signal };
