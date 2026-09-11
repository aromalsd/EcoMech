import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { minuteOfDayToClock } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations", robots: { index: false, follow: false } };

const COOKIE = "kada_admin";

type Row = Record<string, string | number | boolean | null>;

interface Overview {
  ok: boolean;
  totals: Record<string, number>;
  by_kind: Row[];
  by_hour: Array<{ hour: number; n: number }>;
  missed: Row[];
  devices: Row[];
  recent: Row[];
}

async function signIn(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const forwarded = (await headers()).get("x-forwarded-for") ?? "local";

  const { data } = await supabase.rpc("admin_login", {
    p_password: password,
    p_fingerprint: forwarded.split(",")[0].trim(),
  });
  const result = data as { ok: boolean; token?: string; reason?: string } | null;

  if (!result?.ok || !result.token) {
    redirect(`/admin?e=${result?.reason === "locked" ? "locked" : "bad"}`);
  }

  (await cookies()).set(COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/admin");
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const token = (await cookies()).get(COOKIE)?.value;

  let data: Overview | null = null;
  if (token) {
    const { data: result } = await supabase.rpc("admin_overview", { p_token: token });
    if ((result as Overview | null)?.ok) data = result as Overview;
  }

  if (!data) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[22rem] flex-col justify-center px-6">
        <h1 className="font-serif text-[40px] leading-[46px] tracking-[-0.02em]">Operations</h1>
        <p className="mt-1 text-[15px] leading-5 text-(--color-ink-2)">
          {e === "locked"
            ? "Too many attempts. Try again in fifteen minutes."
            : e === "bad"
              ? "That password is not right."
              : "Sign in to continue."}
        </p>
        <form action={signIn} className="mt-5 flex flex-col gap-3">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            aria-label="Password"
            className="glass w-full rounded-[18px] px-4 py-4 text-center text-[17px] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
          />
          <button
            type="submit"
            className="min-h-[52px] rounded-[18px] bg-(--color-ink) px-4 text-[16px] font-semibold text-white transition-opacity active:opacity-80"
          >
            Continue
          </button>
        </form>
      </main>
    );
  }

  const peak = data.by_hour.reduce<{ hour: number; n: number } | null>(
    (best, r) => (best == null || r.n > best.n ? r : best),
    null,
  );
  const maxHour = Math.max(...data.by_hour.map((r) => r.n), 1);

  return (
    <main className="mx-auto w-full max-w-[52rem] px-4 pb-20 pt-8">
      <header className="px-1">
        <h1 className="font-serif text-[40px] leading-[46px] tracking-[-0.02em]">Operations</h1>
        <p className="mt-1 text-[14px] text-(--color-ink-2)">Usage across both outlets.</p>
      </header>

      <section className="glass mt-6 grid grid-cols-3 gap-y-5 rounded-[22px] px-[18px] py-5">
        <Figure label="Visits" value={data.totals.visits} />
        <Figure label="Devices" value={data.totals.devices} />
        <Figure label="Active 24h" value={data.totals.active_24h} />
        <Figure label="Student reports" value={data.totals.reports} />
        <Figure label="Shop counts" value={data.totals.counts} />
        <Figure label="Arrived too late" value={data.totals.missed} />
      </section>

      {data.by_hour.length > 0 ? (
        <Panel title="When people look">
          <div className="mt-3 flex h-24 items-end gap-[3px]">
            {Array.from({ length: 24 }, (_, h) => {
              const n = data.by_hour.find((r) => r.hour === h)?.n ?? 0;
              return (
                <div key={h} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    title={`${h}:00 — ${n}`}
                    className="w-full rounded-t-[2px] bg-(--color-ink)/25"
                    style={{ height: `${Math.max(2, (n / maxHour) * 80)}px` }}
                  />
                  {h % 6 === 0 ? <span className="text-[9px] text-(--color-ink-3)">{h}</span> : null}
                </div>
              );
            })}
          </div>
          {peak ? (
            <p className="mt-2 text-[12px] text-(--color-ink-3)">
              Busiest around {minuteOfDayToClock(peak.hour * 60)}.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Table title="Demand that arrived too late" rows={data.missed} empty="Nothing missed yet." />
      <Table title="Events by kind" rows={data.by_kind} empty="No events yet." />
      <Table title="Devices by activity" rows={data.devices} empty="No devices yet." />
      <Table title="Recent activity" rows={data.recent} empty="Nothing recorded yet." />
    </main>
  );
}

function Figure({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <div className="tnum font-serif text-[30px] leading-9 tracking-[-0.02em]">{value ?? 0}</div>
      <div className="mt-0.5 text-[12px] leading-4 text-(--color-ink-3)">{label}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass mt-3 rounded-[22px] px-[18px] py-5">
      <h2 className="font-serif text-[21px] leading-7 tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

function Table({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-(--color-ink-3)">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.05em] text-(--color-ink-3)">
                {columns.map((c) => (
                  <th key={c} className="pb-2 pr-4 font-medium">
                    {c.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t-[0.5px] border-(--color-separator)">
                  {columns.map((c) => (
                    <td key={c} className="tnum py-1.5 pr-4 align-top">
                      {String(row[c] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
