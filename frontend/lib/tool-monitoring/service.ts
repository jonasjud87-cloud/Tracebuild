/** Reine Ablauflogik der API-Routen: Rollenprüfung, Provider-Auswahl, Cache. Ohne Next.js testbar. */
import type { UserRole } from "@/lib/auth";
import type { TtlCache } from "./cache";
import { safeMessage } from "./http";
import { MISSING_MIGRATION } from "./providers/shared";
import { ORDERED_KEYS, REGISTRY, type Registry } from "./registry";
import { ProviderKeySchema, type CardResult, type MonitoringEnv, type ProviderDeps, type ProviderInfo, type ProviderOutput } from "./types";

export type AccessDenied = { status: 401 | 403; error: string };

/** Nur super_admin. org_admin kommt zwar ins Admin-Layout, hier aber nicht weiter. */
export function checkAccess(user: { role: UserRole } | null): AccessDenied | null {
  if (!user) return { status: 401, error: "Nicht eingeloggt" };
  if (user.role !== "super_admin") return { status: 403, error: "Zugriff verweigert" };
  return null;
}

export function listProviders(env: MonitoringEnv, registry: Registry = REGISTRY): ProviderInfo[] {
  return ORDERED_KEYS.map(key => ({ key, title: registry[key].title, configured: registry[key].configured(env) }));
}

export interface LoadCardOpts {
  env: MonitoringEnv;
  deps: ProviderDeps;
  cache: TtlCache;
  fresh?: boolean;
  usdToChf: number;
  registry?: Registry;
}

export type LoadCardResult = { status: 200; data: CardResult } | { status: 400; error: string };

/** true nur für gültige https-URLs. */
export function isHttpsUrl(href: string): boolean {
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

export async function loadCard(provider: string, opts: LoadCardOpts): Promise<LoadCardResult> {
  const parsed = ProviderKeySchema.safeParse(provider);
  if (!parsed.success) return { status: 400, error: "Unbekannter Dienst" };
  const def = (opts.registry ?? REGISTRY)[parsed.data];

  if (!def.configured(opts.env)) {
    return {
      status: 200,
      data: {
        provider: def.key,
        title: def.title,
        state: "unconfigured",
        message: "Nicht eingerichtet (Umgebungsvariablen fehlen)",
        metrics: [],
        costs: [],
        links: [],
        notes: [],
        checkedAt: opts.deps.now().toISOString(),
        cached: false,
        usdToChf: opts.usdToChf,
      },
    };
  }

  const { value, cached } = await opts.cache.get<CardResult>(
    def.key,
    def.ttlMs,
    async () => {
      let out: ProviderOutput;
      try {
        out = await def.load(opts.env, opts.deps);
      } catch (e) {
        const message = safeMessage(e);
        out = {
          provider: def.key,
          title: def.title,
          // Fehlende Migration ist kein Ausfall des Dienstes.
          state: message === MISSING_MIGRATION ? "warn" : "error",
          message,
          metrics: [],
          costs: [],
          links: [],
          notes: [],
        };
      }
      // Links stammen teils aus fremden Antworten: nur https, sonst weglassen.
      const links = out.links.filter(l => isHttpsUrl(l.href));
      return { ...out, links, checkedAt: opts.deps.now().toISOString(), cached: false, usdToChf: opts.usdToChf };
    },
    { fresh: opts.fresh, isError: r => r.state === "error" }
  );
  return { status: 200, data: { ...value, cached, usdToChf: opts.usdToChf } };
}
