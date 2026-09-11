import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase";
import { decayVerdict, displayState, countToSignal, type AvailState } from "@/lib/scoring";
import type { Item, ItemState, Shop } from "@/lib/types";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Kada — what's left at the counter";

const TONE: Record<AvailState, { fg: string; bg: string; label: string }> = {
  available: { fg: "#2f7d4f", bg: "#e7f2ea", label: "Available" },
  low: { fg: "#a5641b", bg: "#f8efe2", label: "Almost gone" },
  sold_out: { fg: "#b0453a", bg: "#f9e9e7", label: "Sold out" },
  uncertain: { fg: "#5a6478", bg: "#eceef2", label: "Not sure" },
  unknown: { fg: "#97928a", bg: "#efeeec", label: "No word yet" },
};

/**
 * A live preview card. Shared into a group chat, the link itself shows what is
 * left — which is the whole product, delivered without anyone opening it.
 */
export default async function Image() {
  const [shopsRes, itemsRes, statesRes] = await Promise.all([
    supabase.from("shops").select("*").order("sort_order").limit(1),
    supabase.from("items").select("*").order("sort_order"),
    supabase.from("item_state").select("*"),
  ]);

  const shop = ((shopsRes.data ?? []) as Shop[])[0];
  const items = ((itemsRes.data ?? []) as Item[]).filter((i) => i.shop_id === shop?.id).slice(0, 4);
  const states = (statesRes.data ?? []) as ItemState[];
  const now = new Date();

  const rows = items.map((item) => {
    const raw = states.find((s) => s.item_id === item.id) ?? null;
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

    const vendorFresh =
      raw?.last_vendor_at != null &&
      now.getTime() - new Date(raw.last_vendor_at).getTime() < 30 * 60_000;
    const count = vendorFresh ? (raw?.last_vendor_count ?? null) : null;
    const vendorIsLatest =
      raw?.last_vendor_at != null &&
      (raw.last_signal_at == null ||
        new Date(raw.last_vendor_at).getTime() >= new Date(raw.last_signal_at).getTime());

    const state = displayState({ verdict, count, vendorFresh, vendorIsLatest });
    return { name: item.name, count, state, label: count != null ? String(count) : null };
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "52px 68px",
          background: "linear-gradient(135deg, #ffe6c9 0%, #f6f4f1 42%, #ddeee3 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
          <div style={{ fontSize: 62, fontWeight: 700, color: "#191815", letterSpacing: -2 }}>
            Kada
          </div>
          <div style={{ fontSize: 30, color: "#66625a" }}>{shop?.name ?? "Campus counter"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 34 }}>
          {rows.map((row) => (
            <div
              key={row.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(255,255,255,0.72)",
                borderRadius: 22,
                padding: "16px 28px",
              }}
            >
              <div style={{ display: "flex", fontSize: 34, color: "#191815" }}>{row.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                {row.label ? (
                  <div
                    style={{
                      display: "flex",
                      fontSize: 38,
                      fontWeight: 700,
                      color: TONE[row.state].fg,
                    }}
                  >
                    {row.label}
                  </div>
                ) : null}
                <div
                  style={{
                    display: "flex",
                    fontSize: 24,
                    fontWeight: 600,
                    color: TONE[row.state].fg,
                    background: TONE[row.state].bg,
                    borderRadius: 999,
                    padding: "8px 20px",
                  }}
                >
                  {TONE[row.state].label}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: 28, fontSize: 22, color: "#97928a" }}>
          Live from counts at the shop and reports from students
        </div>
      </div>
    ),
    size,
  );
}
