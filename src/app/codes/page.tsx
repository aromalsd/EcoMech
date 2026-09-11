import QRCode from "qrcode";
import { supabase } from "@/lib/supabase";
import type { Shop } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Counter codes — Kada",
  robots: { index: false, follow: false },
};

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://puffsundo.vercel.app";

async function svgFor(url: string) {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#191815", light: "#00000000" },
  });
}

/**
 * A printable sheet for the counters.
 *
 * A code stuck to the counter is the highest-quality signal available: the
 * person scanning it is standing in front of the thing they are reporting on,
 * so the geolocation boost applies almost by definition.
 */
export default async function CodesPage() {
  const { data } = await supabase.from("shops").select("*").order("sort_order");
  const shops = (data ?? []) as Shop[];

  const cards = await Promise.all(
    shops.map(async (shop) => ({
      shop,
      url: `${BASE}/?shop=${shop.slug}`,
      svg: await svgFor(`${BASE}/?shop=${shop.slug}`),
    })),
  );

  const vendorUrl = `${BASE}/vendor`;
  const vendorSvg = await svgFor(vendorUrl);

  return (
    <main className="mx-auto w-full max-w-[46rem] px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <header className="print:hidden">
        <h1 className="font-serif text-[40px] leading-[46px] tracking-[-0.02em]">Counter codes</h1>
        <p className="mt-1 max-w-prose text-[15px] leading-[22px] text-(--color-ink-2)">
          Print this and stick one at each counter. Anyone scanning is standing at the shop, so
          their report is location-verified and carries more weight than one sent from a classroom.
        </p>
      </header>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 print:mt-0 print:grid-cols-2">
        {cards.map(({ shop, svg, url }) => (
          <Card key={shop.id} title={shop.name} caption="Scan to see what's left" svg={svg} url={url} />
        ))}
        <Card
          title="Shop counter"
          caption="For the shopkeeper only"
          svg={vendorSvg}
          url={vendorUrl}
        />
      </div>
    </main>
  );
}

function Card({
  title,
  caption,
  svg,
  url,
}: {
  title: string;
  caption: string;
  svg: string;
  url: string;
}) {
  return (
    <section className="glass flex flex-col items-center rounded-[22px] px-6 py-7 text-center print:rounded-none print:border print:border-black/15 print:bg-white print:shadow-none">
      <div className="font-serif text-[15px] tracking-[0.18em] uppercase text-(--color-ink-3)">
        Kada
      </div>
      <h2 className="mt-1 font-serif text-[27px] leading-8 tracking-[-0.01em]">{title}</h2>
      <div
        className="mt-5 w-[190px]"
        aria-label={`QR code for ${url}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="mt-5 text-[13px] text-(--color-ink-2)">{caption}</p>
      <p className="mt-1 text-[11px] text-(--color-ink-3)">{url.replace(/^https?:\/\//, "")}</p>
    </section>
  );
}
