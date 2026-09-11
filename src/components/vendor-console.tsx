"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getDeviceId } from "@/lib/device";
import {
  parseVendorSession,
  saveVendorSession,
  vendorStore,
  type VendorSession,
} from "@/lib/vendor-session";
import type { Item, ItemState, Shop, VendorLoginResult } from "@/lib/types";

interface Props {
  shops: Shop[];
  items: Item[];
  states: ItemState[];
}

export function VendorConsole({ shops, items, states }: Props) {
  const raw = useSyncExternalStore(
    vendorStore.subscribe,
    vendorStore.getSnapshot,
    vendorStore.getServerSnapshot,
  );
  const session = useMemo(() => parseVendorSession(raw), [raw]);
  const signOut = useCallback(() => saveVendorSession(null), []);

  // `undefined` means storage has not been consulted yet (server render and the
  // hydration pass), which is different from "signed out".
  if (raw === undefined) return <main className="min-h-dvh" />;

  const shop = session ? shops.find((s) => s.id === session.shopId) : undefined;

  // No session, or one pointing at a shop that no longer exists.
  if (!session || !shop) return <PinGate shops={shops} onAuthed={saveVendorSession} />;

  return (
    <Counter
      shop={shop}
      items={items.filter((i) => i.shop_id === shop.id)}
      states={states}
      token={session.token}
      onExpired={signOut}
    />
  );
}

function PinGate({ shops, onAuthed }: { shops: Shop[]; onAuthed: (s: VendorSession) => void }) {
  const [slug, setSlug] = useState(shops[0]?.slug ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const fingerprint = useMemo(() => getDeviceId(), []);

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("vendor_login", {
        p_slug: slug,
        p_pin: pin,
        p_fingerprint: fingerprint,
      });
      if (error) throw error;
      const result = data as VendorLoginResult;
      if (result.ok) {
        onAuthed({ token: result.token, shopId: result.shop_id, slug });
      } else if (result.reason === "locked") {
        toast.error("Too many tries", { description: "Locked for 15 minutes." });
      } else {
        toast.error("Wrong PIN");
        setPin("");
      }
    } catch {
      toast.error("Couldn't sign in", { description: "Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Counter</h1>
      <p className="mt-1 text-sm text-(--color-ink-soft)">
        Enter your PIN to update what&apos;s left.
      </p>

      {shops.length > 1 ? (
        <div className="mt-6 flex gap-1 rounded-xl bg-(--color-void-bg) p-1">
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSlug(s.slug)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                s.slug === slug
                  ? "bg-(--color-surface) text-(--color-ink) shadow-sm"
                  : "text-(--color-ink-soft)"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <input
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="••••••"
        aria-label="PIN"
        className="tnum mt-4 w-full rounded-xl border border-(--color-line) bg-(--color-surface) px-4 py-4 text-center text-2xl tracking-[0.4em] outline-none focus:border-(--color-line-strong)"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={pin.length < 4 || busy}
        className="mt-3 min-h-12 rounded-xl bg-(--color-accent) px-4 font-medium text-(--color-canvas) transition-opacity disabled:opacity-40"
      >
        {busy ? "Checking…" : "Open counter"}
      </button>
    </main>
  );
}

function Counter({
  shop,
  items,
  states,
  token,
  onExpired,
}: {
  shop: Shop;
  items: Item[];
  states: ItemState[];
  token: string;
  onExpired: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, states.find((s) => s.item_id === i.id)?.last_vendor_count ?? 0]),
    ),
  );
  // "Never counted" and "counted zero" look identical in a number but mean
  // very different things, so track which items the shop has actually set.
  const [counted, setCounted] = useState<Set<string>>(
    () =>
      new Set(
        items
          .filter((i) => states.find((s) => s.item_id === i.id)?.last_vendor_count != null)
          .map((i) => i.id),
      ),
  );
  const [saving, setSaving] = useState<string | null>(null);

  const push = useCallback(
    async (itemId: string, next: number) => {
      setSaving(itemId);
      try {
        const { data, error } = await supabase.rpc("vendor_set", {
          p_token: token,
          p_item: itemId,
          p_count: next,
        });
        if (error) throw error;
        const result = data as { ok: boolean; reason?: string };
        if (!result.ok) {
          if (result.reason === "bad_session") {
            toast.error("Signed out", { description: "Enter your PIN again." });
            onExpired();
          } else {
            toast.error("Couldn't save that");
          }
        }
      } catch {
        toast.error("Couldn't reach the board");
      } finally {
        setSaving(null);
      }
    },
    [onExpired, token],
  );

  const adjust = (itemId: string, delta: number) => {
    setCounted((prev) => (prev.has(itemId) ? prev : new Set(prev).add(itemId)));
    setCounts((prev) => {
      const next = Math.max(0, (prev[itemId] ?? 0) + delta);
      void push(itemId, next);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(8);
      return { ...prev, [itemId]: next };
    });
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{shop.name}</h1>
          <p className="mt-0.5 text-sm text-(--color-ink-soft)">Tap to update what&apos;s left.</p>
        </div>
      </header>

      <ul className="grid gap-3">
        {items.map((item) => {
          const value = counts[item.id] ?? 0;
          return (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-2xl border border-(--color-line) bg-(--color-surface) p-3"
            >
              <span aria-hidden className="text-2xl leading-none">
                {item.emoji ?? "🍽"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold tracking-tight">{item.name}</div>
                <div className="text-xs text-(--color-ink-faint)">
                  {saving === item.id
                    ? "saving…"
                    : !counted.has(item.id)
                      ? "not counted yet"
                      : value === 0
                        ? "sold out"
                        : `${value} left`}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StepButton
                  label={`One fewer ${item.name}`}
                  onClick={() => adjust(item.id, -1)}
                  disabled={value === 0 && counted.has(item.id)}
                >
                  <Minus className="size-5" aria-hidden />
                </StepButton>

                <motion.span
                  key={value}
                  aria-hidden={!counted.has(item.id)}
                  initial={{ scale: 0.8, opacity: 0.4 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  className="tnum w-10 text-center text-2xl font-semibold"
                >
                  {value}
                </motion.span>

                <StepButton label={`One more ${item.name}`} onClick={() => adjust(item.id, 1)}>
                  <Plus className="size-5" aria-hidden />
                </StepButton>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-center text-[11px] text-(--color-ink-faint)">
        Your counts are treated as the truth and reset what students have reported.
      </p>
    </main>
  );
}

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-12 items-center justify-center rounded-xl border border-(--color-line) text-(--color-ink) transition-colors active:bg-(--color-void-bg) disabled:opacity-30"
    >
      {children}
    </button>
  );
}
