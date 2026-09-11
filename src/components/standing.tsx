"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface StandingData {
  reports: number;
  graded: number;
  accuracy: number | null;
  weight: number;
}

/** Shows a reporter how much their own reports currently count for. */
export function Standing({ deviceId, refreshKey }: { deviceId: string; refreshKey: number }) {
  const [data, setData] = useState<StandingData | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    void supabase.rpc("my_standing", { p_device: deviceId }).then(({ data: result }) => {
      if (!cancelled && result) setData(result as StandingData);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, refreshKey]);

  if (!data || data.reports === 0) return null;

  const accuracyPct = data.accuracy != null ? Math.round(data.accuracy * 100) : null;

  return (
    <section className="glass mt-5 rounded-[22px] px-[18px] py-[15px]">
      <h2 className="font-serif text-[19px] leading-6 tracking-[-0.01em]">Your standing</h2>
      <p className="mt-1.5 text-[13px] leading-[19px] text-(--color-ink-2)">
        {data.reports} {data.reports === 1 ? "report" : "reports"} sent.{" "}
        {accuracyPct != null ? (
          <>
            The shop&apos;s own counts have agreed with you{" "}
            <span className="font-semibold text-(--color-ink)">{accuracyPct}%</span> of the time, so
            your word currently counts for{" "}
            <span className="tnum font-semibold text-(--color-ink)">{data.weight}×</span> a new
            reporter&apos;s.
          </>
        ) : (
          <>Once the shop posts a count, we can check your reports against it and your word will
          start to carry more weight.</>
        )}
      </p>
    </section>
  );
}
