import type { ProviderDef, ProviderKey } from "./types";
import { PROVIDER_KEYS } from "./types";
import { anthropicProvider } from "./providers/anthropic";
import { domainProvider } from "./providers/domain";
import { geoportalProvider } from "./providers/geoportal";
import { githubProvider } from "./providers/github";
import { resendProvider } from "./providers/resend";
import { statusProvider } from "./providers/status";
import { supabaseProvider } from "./providers/supabase";
import { vercelProvider } from "./providers/vercel";

export type Registry = Record<ProviderKey, ProviderDef>;

export const REGISTRY: Registry = {
  status: statusProvider,
  vercel: vercelProvider,
  supabase: supabaseProvider,
  github: githubProvider,
  resend: resendProvider,
  anthropic: anthropicProvider,
  domain: domainProvider,
  geoportal: geoportalProvider,
};

export const ORDERED_KEYS: readonly ProviderKey[] = PROVIDER_KEYS;
