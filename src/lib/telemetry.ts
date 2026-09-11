import { supabase } from "@/lib/supabase";

export type EventKind = "visit" | "shop_view" | "item_missed" | "report" | "install";

/** Fire-and-forget usage logging. Never awaited, never surfaces an error. */
export function logEvent(
  kind: EventKind,
  deviceId: string,
  opts: { shopId?: string | null; itemId?: string | null; meta?: Record<string, unknown> } = {},
) {
  if (!deviceId) return;
  void supabase
    .rpc("log_event", {
      p_kind: kind,
      p_device: deviceId,
      p_shop: opts.shopId ?? null,
      p_item: opts.itemId ?? null,
      p_meta: opts.meta ?? {},
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
