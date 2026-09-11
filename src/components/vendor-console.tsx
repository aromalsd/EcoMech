"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-[22rem] flex-col justify-center px-6">
      <h1 className="font-serif text-[40px] leading-[46px] tracking-[-0.02em]">Counter</h1>
      <p className="mt-1 text-[15px] leading-5 text-(--color-ink-2)">
        Enter your PIN to update what&apos;s left.
      </p>

      {shops.length > 1 ? (
        <div className="glass mt-6 flex gap-[3px] rounded-full p-[3px]">
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSlug(s.slug)}
              className={`flex-1 rounded-full px-3 py-[8px] text-[13.5px] font-semibold transition-colors ${
                s.slug === slug
                  ? "bg-white text-(--color-ink) shadow-[0_1px_3px_rgba(0,0,0,0.10),0_1px_1px_rgba(0,0,0,0.05)]"
                  : "text-(--color-ink-2)"
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
        className="glass tnum mt-4 w-full rounded-[18px] px-4 py-4 text-center text-[26px] tracking-[0.4em] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={pin.length < 4 || busy}
        className="mt-3 min-h-[52px] rounded-[18px] bg-(--color-ink) px-4 text-[16px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-30"
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
    <main className="mx-auto w-full max-w-[34rem] px-4 pb-20 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-5 px-1">
        <h1 className="font-serif text-[36px] leading-[42px] tracking-[-0.02em]">{shop.name}</h1>
        <p className="mt-1 text-[15px] leading-5 text-(--color-ink-2)">
          Tap to update what&apos;s left.
        </p>
      </header>

      <ul className="flex flex-col gap-[10px]">
        {items.map((item) => {
          const value = counts[item.id] ?? 0;
          return (
            <li
              key={item.id}
              className="glass flex items-center gap-3 rounded-[22px] px-[18px] py-[14px]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-serif text-[23px] leading-[30px] tracking-[-0.012em]">
                  {item.name}
                </div>
                <div className="mt-px text-[13px] leading-[18px] text-(--color-ink-3)">
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

                <span className="tnum w-10 text-center text-2xl font-semibold">{value}</span>

                <StepButton label={`One more ${item.name}`} onClick={() => adjust(item.id, 1)}>
                  <Plus className="size-5" aria-hidden />
                </StepButton>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 px-4 text-[12px] leading-[17px] text-(--color-ink-3)">
        Your counts are treated as the truth, and replace whatever students have reported.
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
      className="flex size-11 items-center justify-center rounded-full bg-black/[0.06] text-(--color-ink) transition-colors active:bg-black/[0.12] disabled:opacity-25"
    >
      {children}
    </button>
  );
}
