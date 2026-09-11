import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "How Kada knows — Kada",
  description: "What the board is built from, and how well it has been doing.",
};

interface Stats {
  reports_total: number;
  vendor_updates: number;
  reporters: number;
  items_tracked: number;
  missed_total: number;
  visits_total: number;
  graded: number;
  accuracy: number | null;
  by_day: Array<{ day: string; reports: number }>;
}

export default async function StatsPage() {
  const { data } = await supabase.rpc("public_stats");
  const s = (data ?? null) as Stats | null;

  return (
    <main className="mx-auto w-full max-w-[34rem] px-4 pb-20 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="px-1">
        <Link href="/" className="text-[13px] font-medium text-(--color-ink-2)">
          ← Board
        </Link>
        <h1 className="mt-2 font-serif text-[40px] leading-[46px] tracking-[-0.02em]">
          How Kada knows
        </h1>
        <p className="mt-1 text-[15px] leading-5 text-(--color-ink-2)">
          Nothing here is measured by a machine at the counter. It is all reconstructed.
        </p>
      </header>

      {s ? (
        <>
          <section className="glass mt-6 grid grid-cols-2 gap-y-5 rounded-[22px] px-[18px] py-5">
            <Figure label="Reports from students" value={s.reports_total} />
            <Figure label="Counts from the shops" value={s.vendor_updates} />
            <Figure label="People reporting" value={s.reporters} />
            <Figure label="Items tracked" value={s.items_tracked} />
            <Figure label="Visits" value={s.visits_total} />
            <Figure label="Arrived too late" value={s.missed_total} />
          </section>

          <section className="glass mt-3 rounded-[22px] px-[18px] py-5">
            <h2 className="font-serif text-[21px] leading-7 tracking-[-0.01em]">
              Is the crowd any good?
            </h2>
            <p className="mt-2 text-[13.5px] leading-[20px] text-(--color-ink-2)">
              {s.accuracy != null ? (
                <>
                  Every time a shop enters a count, the reports made just before it are graded
                  against the truth. Across {s.graded}{" "}
                  {s.graded === 1 ? "reporter" : "reporters"} who have been checked this way, the
                  crowd has been right{" "}
                  <span className="font-semibold text-(--color-ink)">
                    {Math.round(s.accuracy * 100)}%
                  </span>{" "}
                  of the time. Reporters who are wrong repeatedly are quietly weighted down.
                </>
              ) : (
                <>
                  Nobody has been graded yet. As soon as a shop enters a count, every report made in
                  the previous 25 minutes gets checked against it, and reporters start earning — or
                  losing — influence.
                </>
              )}
            </p>
          </section>

          <DayChart days={s.by_day ?? []} />
        </>
      ) : (
        <p className="glass mt-6 rounded-[22px] px-[18px] py-10 text-center text-[15px] text-(--color-ink-3)">
          Figures are unavailable right now.
        </p>
      )}

      <section className="glass mt-3 rounded-[22px] px-[18px] py-5">
        <h2 className="font-serif text-[21px] leading-7 tracking-[-0.01em]">Why it fades</h2>
        <p className="mt-2 text-[13.5px] leading-[20px] text-(--color-ink-2)">
          Every report loses influence exponentially as it ages, and it does so faster during the
          breaks when stock actually moves — eight minutes to lose a third of its weight at 10:45,
          twenty minutes at three in the afternoon. A count from the shop outweighs a student and
          resets everything said before it. When nothing recent survives, the board says nobody
          knows rather than guessing.
        </p>
      </section>
    </main>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="tnum font-serif text-[30px] leading-9 tracking-[-0.02em]">{value}</div>
      <div className="mt-0.5 text-[12px] leading-4 text-(--color-ink-3)">{label}</div>
    </div>
  );
}

function DayChart({ days }: { days: Array<{ day: string; reports: number }> }) {
  if (days.length === 0) return null;
  const max = Math.max(...days.map((d) => d.reports), 1);

  return (
    <section className="glass mt-3 rounded-[22px] px-[18px] py-5">
      <h2 className="font-serif text-[21px] leading-7 tracking-[-0.01em]">Reports per day</h2>
      <div className="mt-4 flex h-24 items-end gap-[5px]" role="img" aria-label="Reports per day">
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.reports}`}
            className="flex-1 rounded-t-[3px] bg-(--color-ink)/25"
            style={{ height: `${Math.max(4, (d.reports / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-(--color-ink-3)">
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </section>
  );
}
