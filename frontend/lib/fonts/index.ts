import localFont from "next/font/local";

export const inter = localFont({
  src: "./inter-latin.woff2",
  weight: "100 900",
  variable: "--font-sans",
  display: "swap",
});

export const archivo = localFont({
  src: "./archivo-latin.woff2",
  weight: "100 900",
  variable: "--font-display",
  display: "swap",
});

export const jakarta = localFont({
  src: "./jakarta-latin.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
});

export const plexSans = localFont({
  src: [
    { path: "./plex-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./plex-sans-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--hb-body",
  display: "swap",
});

export const plexMono = localFont({
  src: "./plex-mono-500.woff2",
  weight: "500",
  variable: "--hb-mono",
  display: "swap",
});

export const instrument = localFont({
  src: "./instrument-latin.woff2",
  weight: "400 700",
  variable: "--hb-display",
  display: "swap",
});
