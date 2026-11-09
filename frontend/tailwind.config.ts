import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "tb-black": "#151414",
        "tb-surface": "#1c1b1b",
        "tb-graphite": "#2e2e30",
        "tb-graphite-hover": "#3a3a3d",
        "tb-white": "#ffffff",
        "tb-beige": "#cbbfae",
        "tb-beige-hover": "#d8cebf",
        "tb-beige-deep": "#b5a893",
        "tb-cream": "#f6f3ee",
        "tb-bronze-ink": "#6b6153",
      },
      fontFamily: {
        sans:    ["var(--font-sans)", "Arial", "Helvetica", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "Arial", "sans-serif"],
      },
      boxShadow: {
        elevated: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
        float:    "0 4px 24px rgba(0,0,0,0.08), 0 12px 48px rgba(0,0,0,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
