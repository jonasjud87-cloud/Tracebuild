import type { Metadata } from "next";
import { Inter, Archivo } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://tracebuild.vercel.app";
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
