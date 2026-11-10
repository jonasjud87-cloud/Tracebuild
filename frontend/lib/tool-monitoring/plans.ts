/**
 * Hinterlegte Pläne der Dienste. Werte aus den öffentlichen Preisseiten, Stand PLANS_VERSION.
 * Bei Planwechsel hier anpassen und Version erhöhen. Karten kennzeichnen diese Werte als «Plan».
 */
export const PLANS_VERSION = "2026-11";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const PLANS = {
  vercel: {
    name: "Hobby",
    baseUsd: 0,
    billingUrl: "https://vercel.com/dashboard/usage",
  },
  supabase: {
    name: "Free",
    baseUsd: 0,
    dbBytes: 500 * MB,
    storageBytes: 1 * GB,
    mau: 50_000,
    costHint: "Nutzungsabhängige Kosten möglich, siehe Abrechnung",
    billingUrl: "https://supabase.com/dashboard/org/_/billing",
  },
  resend: {
    name: "Free",
    baseUsd: 0,
    /** Fallback, falls /usage keine Limits liefert. */
    dailyLimit: 100,
    monthlyLimit: 3000,
    domainLimit: 1,
    billingUrl: "https://resend.com/settings/billing",
  },
} as const;
