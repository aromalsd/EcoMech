"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tickNow, useClock } from "@/lib/use-clock";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";
import { distanceMetres } from "@/lib/scoring";
import { GEO_RADIUS_M } from "@/lib/scoring/constants";
import { ItemRow } from "./item-row";
import type { Item, ItemState, Shop, Signal, SubmitResult } from "@/lib/types";

interface Props {
  shops: Shop[];
  items: Item[];
  initialStates: ItemState[];
}

export function Board({ shops, items, initialStates }: Props) {
  const [activeSlug, setActiveSlug] = useState(shops[0]?.slug ?? "");
  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(initialStates.map((s) => [s.item_id, s])),
  );
  // Null during SSR and hydration: decay depends on the wall clock, so deriving
  // it on the server guarantees a mismatch. The first paint renders exactly
  // what the server stored and the clock takes over immediately after.
  const now = useClock();
  const [watching, setWatching] = useState(1);
  const [pending, setPending] = useState<Record<string, Signal | null>>({});
  // Realtime is preferred but not assumed: many campus and corporate networks
  // block websockets outright, so the board degrades to HTTPS polling rather
  // than silently going stale.
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");

  const deviceId = useMemo(() => getDeviceId(), []);
  const coords = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    const channel = supabase
      .channel("kada-board", { config: { presence: { key: deviceId } } })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_state" },
        (payload) => {
          const row = payload.new as ItemState | null;
          if (!row?.item_id) return;
          setStates((prev) => ({ ...prev, [row.item_id]: row }));
          tickNow();
        },
      )
      .on("presence", { event: "sync" }, () => {
        setWatching(Object.keys(channel.presenceState()).length || 1);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setMode("live");
          void channel.track({ at: Date.now() });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setMode((m) => (m === "live" ? m : "polling"));
        }
      });

    const giveUp = setTimeout(() => {
      setMode((m) => (m === "live" ? m : "polling"));
    }, 6_000);

    return () => {
      clearTimeout(giveUp);
      void supabase.removeChannel(channel);
    };
  }, [deviceId]);

  const refreshStates = useCallback(async () => {
    const { data } = await supabase.from("item_state").select("*");
    if (!data) return;
    setStates(Object.fromEntries((data as ItemState[]).map((s) => [s.item_id, s])));
    tickNow();
  }, []);

  useEffect(() => {
    if (mode !== "polling") return;
    // refreshStates only sets state after an awaited round trip, so this never
    // re-renders synchronously; the rule cannot see across the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStates();
    const id = setInterval(() => void refreshStates(), 6_000);
    return () => clearInterval(id);
  }, [mode, refreshStates]);

  // Location is a weighting hint, never a gate: a refused prompt must not
  // prevent anyone from reporting.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 },
    );
  }, []);

  const activeShop = shops.find((s) => s.slug === activeSlug) ?? shops[0];
  const visible = items.filter((i) => i.shop_id === activeShop?.id);

  const report = useCallback(
    async (itemId: string, signal: Signal) => {
      if (pending[itemId]) return;
      setPending((p) => ({ ...p, [itemId]: signal }));

      let geo = false;
      if (coords.current && activeShop?.lat != null && activeShop?.lng != null) {
        geo =
          distanceMetres(coords.current, { lat: activeShop.lat, lng: activeShop.lng }) <=
          GEO_RADIUS_M;
      }

      try {
        const { data, error } = await supabase.rpc("submit_report", {
          p_item: itemId,
          p_signal: signal,
          p_device: deviceId,
          p_geo: geo,
        });
        if (error) throw error;

        const result = data as SubmitResult;
        if (result.ok) {
          toast.success("Thanks — recorded", {
            description: geo ? "Verified at the counter, weighted higher." : undefined,
          });
          if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(12);
          // Don't wait on the transport to reflect the user's own action.
          void refreshStates();
        } else if (result.reason === "rate_limited") {
          toast("Already counted", {
            description: `You reported this one recently. Try again in ${result.retry_after_s}s.`,
          });
        } else if (result.reason === "hourly_limit" || result.reason === "network_limit") {
          toast("That's plenty for now", {
            description: "Too many reports in the last hour. It'll reset shortly.",
          });
        } else {
          toast.error("Couldn't record that");
        }
      } catch {
        toast.error("Couldn't reach the board", { description: "Check your connection." });
      } finally {
        setPending((p) => ({ ...p, [itemId]: null }));
      }
    },
    [activeShop, deviceId, pending, refreshStates],
  );

  return (
    <main className="mx-auto w-full max-w-[34rem] px-4 pb-20 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="px-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-title font-bold">Kada</h1>
          <span className="flex items-center gap-[6px] text-[12px] text-(--color-ink-3)">
            <span
              aria-hidden
              className="size-[6px] rounded-full"
              style={{
                background:
                  mode === "live"
                    ? "var(--color-ok)"
                    : mode === "polling"
                      ? "var(--color-low)"
                      : "var(--color-void)",
              }}
            />
            {mode === "live" ? `${watching} here now` : mode === "polling" ? "Updating" : "Connecting"}
          </span>
        </div>
        <p className="mt-1 text-[15px] leading-5 text-(--color-ink-2)">
          What&apos;s left at the counter, right now.
        </p>
      </header>

      {/* iOS-style segmented control */}
      <div
        role="tablist"
        aria-label="Outlets"
        className="mt-5 flex gap-[2px] rounded-[9px] bg-(--color-fill) p-[2px]"
      >
        {shops.map((shop) => {
          const selected = shop.slug === activeShop?.slug;
          return (
            <button
              key={shop.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveSlug(shop.slug)}
              className={`flex-1 rounded-[7px] px-3 py-[7px] text-[13px] font-medium transition-colors ${
                selected
                  ? "bg-(--color-surface) text-(--color-ink) shadow-[0_1px_3px_rgba(0,0,0,0.10),0_1px_1px_rgba(0,0,0,0.04)]"
                  : "text-(--color-ink-2)"
              }`}
            >
              {shop.name}
            </button>
          );
        })}
      </div>

      {activeShop?.subtitle ? (
        <p className="mt-5 px-4 text-[13px] uppercase tracking-[0.05em] text-(--color-ink-3)">
          {activeShop.subtitle}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-3 rounded-[12px] bg-(--color-surface) px-4 py-10 text-center text-[15px] text-(--color-ink-3)">
          Nothing on the menu here yet.
        </p>
      ) : (
        <ul className="rows mt-2 overflow-hidden rounded-[12px] bg-(--color-surface)">
          {visible.map((item) => (
            <ItemRow
              key={item.id}
              item={{ ...item, state: states[item.id] ?? null }}
              now={now}
              pending={pending[item.id] ?? null}
              onReport={(signal) => void report(item.id, signal)}
            />
          ))}
        </ul>
      )}

      <footer className="mt-6 px-4 text-[12px] leading-[17px] text-(--color-ink-3)">
        Availability is estimated from counts at the shop and reports from students, and fades as
        it ages. The confidence shown is real — when nobody knows, it says so.
      </footer>
    </main>
  );
}
