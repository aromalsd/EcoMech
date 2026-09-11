import { VendorConsole } from "@/components/vendor-console";
import { supabase } from "@/lib/supabase";
import type { Item, ItemState, Shop } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Counter — Kada",
  robots: { index: false, follow: false },
};

export default async function VendorPage() {
  const [shopsRes, itemsRes, statesRes] = await Promise.all([
    supabase.from("shops").select("*").order("sort_order"),
    supabase.from("items").select("*").order("sort_order"),
    supabase.from("item_state").select("*"),
  ]);

  return (
    <VendorConsole
      shops={(shopsRes.data ?? []) as Shop[]}
      items={(itemsRes.data ?? []) as Item[]}
      states={(statesRes.data ?? []) as ItemState[]}
    />
  );
}
