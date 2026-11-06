import type { Metadata } from "next";
import { inter, archivo } from "@/lib/fonts";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.tracebuild.ch";
const TITLE = "TraceBuild - Zeichnungen prüfen, Normen einhalten";
const DESCRIPTION =
  "Pläne als PDF hochladen, KI-Prüfung gegen geltende Normen, eine klare Übersicht der Befunde. TraceBuild prüft - ändern und freigeben bleibt bei Ihrem Team.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "TraceBuild",
  openGraph: {
    type: "website",
    locale: "de_CH",
    siteName: "TraceBuild",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${inter.variable} ${archivo.variable}`}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
