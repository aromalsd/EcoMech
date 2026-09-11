"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { minuteOfDayToClock } from "@/lib/format";

interface Insights {
  ok: boolean;
  missed_7d: Array<{ name: string; times: number; people: number }>;
  visits_7d: number;
  reports_7d: number;
  soldout_days: Array<{ name: string; minute: number; days: number }>;
  busiest_hour: number | null;
}

/**
 * What the shop cannot see from behind the counter.
 *
 * The demand figure is the point: people who came looking after something had
 * already run out leave no trace in the till, so this is the only place that
 * number exists.
 */
export function ShopInsights({ token }: { token: string }) {
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("shop_insights", { p_token: token }).then(({ data: result }) => {
      if (!cancelled && result && (result as Insights).ok) setData(result as Insights);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!data) return null;

  const busiest = data.busiest_hour != null ? minuteOfDayToClock(data.busiest_hour * 60) : null;
  const missed = data.missed_7d ?? [];
  const soldout = data.soldout_days ?? [];

  return (
    <section className="glass mt-3 rounded-[22px] px-[18px] py-[15px]">
      <h2 className="font-serif text-[21px] leading-7 tracking-[-0.01em]">This week</h2>

      <p className="mt-2 text-[13.5px] leading-[20px] text-(--color-ink-2)">
        <span className="font-semibold text-(--color-ink)">{data.visits_7d}</span>{" "}
        {data.visits_7d === 1 ? "person" : "people"} checked your counter, and students sent{" "}
        <span className="font-semibold text-(--color-ink)">{data.reports_7d}</span>{" "}
        {data.reports_7d === 1 ? "report" : "reports"}.
        {busiest ? <> Most of them look around {busiest}.</> : null}
      </p>

      {missed.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-(--color-ink-3)">
            Came looking, already gone
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {missed.map((row) => (
              <li key={row.name} className="flex items-baseline justify-between gap-3 text-[14px]">
                <span>{row.name}</span>
                <span className="tnum text-(--color-ink-2)">
                  {row.people} {row.people === 1 ? "person" : "people"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-[17px] text-(--color-ink-3)">
            These are customers who walked over and found nothing. They never reach your till.
          </p>
        </div>
      ) : null}

      {soldout.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-(--color-ink-3)">
            Typically runs out
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {soldout.map((row) => (
              <li key={row.name} className="flex items-baseline justify-between gap-3 text-[14px]">
                <span>{row.name}</span>
                <span className="tnum text-(--color-ink-2)">
                  {minuteOfDayToClock(row.minute)}
                  <span className="text-(--color-ink-3)"> · {row.days}d</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
