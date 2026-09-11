import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kada — what's left at the counter",
  description:
    "Know whether the puffs are gone before you walk over. Live availability for the college canteen and the shop outside.",
  applicationName: "Kada",
  appleWebApp: { capable: true, title: "Kada", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f3f0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster
          position="top-center"
          gap={8}
          toastOptions={{
            style: {
              background: "rgba(255,255,255,0.92)",
              backdropFilter: "saturate(180%) blur(20px)",
              color: "var(--color-ink)",
              border: "0.5px solid var(--color-hairline)",
              borderRadius: "14px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.10)",
              fontSize: "14px",
            },
          }}
        />
      </body>
    </html>
  );
}
