"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tickNow, useClock } from "@/lib/use-clock";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";
import { distanceMetres } from "@/lib/scoring";
import { GEO_RADIUS_M } from "@/lib/scoring/constants";
import { ItemRow, type Rhythm } from "./item-row";
import { logEvent } from "@/lib/telemetry";
import { Standing } from "./standing";
import type { Item, ItemState, Shop, Signal, SubmitResult } from "@/lib/types";

interface Props {
  shops: Shop[];
  items: Item[];
  initialStates: ItemState[];
  /** From ?shop=<slug>, so a code scanned at a counter opens that outlet. */
  initialSlug?: string;
}

export function Board({ shops, items, initialStates, initialSlug }: Props) {
  const [activeSlug, setActiveSlug] = useState(
    () => shops.find((s) => s.slug === initialSlug)?.slug ?? shops[0]?.slug ?? "",
  );
  const [states, setStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(initialStates.map((s) => [s.item_id, s])),
  );
  // Null during SSR and hydration; the first paint renders the stored values.
  const now = useClock();
  const [watching, setWatching] = useState(1);
  const [pending, setPending] = useState<Record<string, Signal | null>>({});
  // Falls back to polling where websockets are unavailable.
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  const [reportCount, setReportCount] = useState(0);
  const [rhythms, setRhythms] = useState<Record<string, Rhythm>>({});

  const activeShop = shops.find((s) => s.slug === activeSlug) ?? shops[0];
  const activeShopId = activeShop?.id ?? null;

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
    // Sets state only after an awaited round trip, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStates();
    const id = setInterval(() => void refreshStates(), 6_000);
    return () => clearInterval(id);
  }, [mode, refreshStates]);

  useEffect(() => {
    if (!deviceId) return;
    logEvent("visit", deviceId);
    if (window.matchMedia("(display-mode: standalone)").matches) {
      logEvent("install", deviceId);
    }
  }, [deviceId]);

  // Recorded once per item per visit so a lingering tab cannot inflate it.
  const missed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!deviceId || !activeShopId) return;
    logEvent("shop_view", deviceId, { shopId: activeShopId });
    for (const item of items) {
      if (item.shop_id !== activeShopId) continue;
      const state = states[item.id]?.state;
      if ((state === "sold_out" || state === "low") && !missed.current.has(item.id)) {
        missed.current.add(item.id);
        logEvent("item_missed", deviceId, {
          shopId: activeShopId,
          itemId: item.id,
          meta: { state },
        });
      }
    }
    // Keyed on the shop only: a per-visit signal, not a live subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, activeShopId]);

  useEffect(() => {
    if (!activeShopId) return;
    let cancelled = false;
    void supabase.rpc("shop_rhythms", { p_shop: activeShopId }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      setRhythms(
        Object.fromEntries(
          (data as Array<{ item_id: string; days: number; minute: number }>).map((r) => [
            r.item_id,
            { days: r.days, minute: r.minute },
          ]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeShopId]);

  // Location only adjusts weighting; a refused prompt must not block reporting.
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
          logEvent("report", deviceId, { itemId, meta: { signal, geo } });
          setReportCount((n) => n + 1);
          // Reflect the user's own action without waiting on the transport.
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
          <h1 className="font-serif text-[40px] leading-[46px] tracking-[-0.02em]">Kada</h1>
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
        className="glass mt-5 flex gap-[3px] rounded-full p-[3px]"
      >
        {shops.map((shop) => {
          const selected = shop.slug === activeShop?.slug;
          return (
            <button
              key={shop.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveSlug(shop.slug)}
              className={`flex-1 rounded-full px-3 py-[8px] text-[13.5px] font-semibold transition-colors ${
                selected
                  ? "bg-white text-(--color-ink) shadow-[0_1px_3px_rgba(0,0,0,0.10),0_1px_1px_rgba(0,0,0,0.05)]"
                  : "text-(--color-ink-2)"
              }`}
            >
              {shop.name}
            </button>
          );
        })}
      </div>

      {activeShop?.subtitle ? (
        <p className="mt-6 px-1 text-[12px] font-medium uppercase tracking-[0.07em] text-(--color-ink-3)">
          {activeShop.subtitle}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="glass mt-2 rounded-[22px] px-4 py-10 text-center text-[15px] text-(--color-ink-3)">
          Nothing on the menu here yet.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-[10px]">
          {visible.map((item) => (
            <ItemRow
              key={item.id}
              item={{ ...item, state: states[item.id] ?? null }}
              rhythm={rhythms[item.id] ?? null}
              now={now}
              pending={pending[item.id] ?? null}
              onReport={(signal) => void report(item.id, signal)}
            />
          ))}
        </ul>
      )}

      <Standing deviceId={deviceId} refreshKey={reportCount} />

      <footer className="mt-6 px-1">
        <p className="text-[12px] leading-[17px] text-(--color-ink-3)">
          Availability is estimated from counts at the shop and reports from students, and fades as
          it ages. The confidence shown is real — when nobody knows, it says so.
        </p>
        <p className="mt-3 flex items-center gap-3 text-[11px] text-(--color-ink-3)">
          <a href="/stats" className="font-medium text-(--color-ink-2) underline-offset-2 hover:underline">
            How this works
          </a>
          <span aria-hidden>·</span>
          <span>
            Built by{" "}
            <span className="font-serif text-[15px] italic tracking-[0.04em] text-(--color-ink-2)">
              S D
            </span>
          </span>
        </p>
      </footer>
    </main>
  );
}
