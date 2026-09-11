"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";
import { distanceMetres } from "@/lib/scoring";
import { GEO_RADIUS_M } from "@/lib/scoring/constants";
import { ItemCard } from "./item-card";
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
  // Null until mounted. Decay depends on the wall clock, so computing it during
  // SSR guarantees a hydration mismatch; the first paint renders exactly what
  // the server stored and the clock starts afterwards.
  const [now, setNow] = useState<Date | null>(null);
  const [watching, setWatching] = useState(1);
  const [pending, setPending] = useState<Record<string, Signal | null>>({});
  // Realtime is preferred but not assumed: many campus and corporate networks
  // block websockets outright, so the board degrades to HTTPS polling rather
  // than silently going stale.
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");

  const deviceId = useMemo(() => getDeviceId(), []);
  const coords = useRef<{ lat: number; lng: number } | null>(null);

  // Drives continuous confidence decay without touching the database.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 5_000);
    return () => clearInterval(id);
  }, []);

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
          setNow(new Date());
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
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (mode !== "polling") return;
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
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-6 sm:pt-10">
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Kada</h1>
          <span className="flex items-center gap-1.5 text-xs text-(--color-ink-faint)">
            <span
              className={`size-1.5 rounded-full ${
                mode === "live"
                  ? "bg-(--color-ok)"
                  : mode === "polling"
                    ? "bg-(--color-warn)"
                    : "bg-(--color-void)"
              }`}
              aria-hidden
            />
            {mode === "live" ? `${watching} watching` : mode === "polling" ? "updating" : "connecting"}
          </span>
        </div>
        <p className="mt-1 text-sm text-(--color-ink-soft)">
          Live counter for campus snacks. Tell everyone what&apos;s left.
        </p>
      </header>

      <div role="tablist" aria-label="Outlets" className="mb-5 flex gap-1 rounded-xl bg-(--color-void-bg) p-1">
        {shops.map((shop) => {
          const selected = shop.slug === activeShop?.slug;
          return (
            <button
              key={shop.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveSlug(shop.slug)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "bg-(--color-surface) text-(--color-ink) shadow-sm"
                  : "text-(--color-ink-soft) hover:text-(--color-ink)"
              }`}
            >
              {shop.name}
            </button>
          );
        })}
      </div>

      {activeShop?.subtitle ? (
        <p className="mb-4 text-xs text-(--color-ink-faint)">{activeShop.subtitle}</p>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-(--color-line) p-8 text-center text-sm text-(--color-ink-faint)">
          Nothing on the menu here yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((item) => (
            <ItemCard
              key={item.id}
              item={{ ...item, state: states[item.id] ?? null }}
              now={now}
              pending={pending[item.id] ?? null}
              onReport={(signal) => void report(item.id, signal)}
            />
          ))}
        </ul>
      )}

      <footer className="mt-8 text-center text-[11px] leading-relaxed text-(--color-ink-faint)">
        Availability is estimated from vendor counts and student reports, and decays as it ages.
        <br />
        Confidence shown is real — an empty bar means nobody knows.
      </footer>
    </main>
  );
}
