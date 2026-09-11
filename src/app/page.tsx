import { Board } from "@/components/board";
import { supabase } from "@/lib/supabase";
import type { Item, ItemState, Shop } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [shopsRes, itemsRes, statesRes] = await Promise.all([
    supabase.from("shops").select("*").order("sort_order"),
    supabase.from("items").select("*").order("sort_order"),
    supabase.from("item_state").select("*"),
  ]);

  const shops = (shopsRes.data ?? []) as Shop[];
  const items = (itemsRes.data ?? []) as Item[];
  const states = (statesRes.data ?? []) as ItemState[];

  const failed = shopsRes.error ?? itemsRes.error ?? statesRes.error;
  if (failed && shops.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">Can&apos;t reach the counter</h1>
        <p className="text-sm text-(--color-ink-soft)">
          The board is temporarily unavailable. It will come back on its own — try again in a moment.
        </p>
      </main>
    );
  }

  return <Board shops={shops} items={items} initialStates={states} />;
}
