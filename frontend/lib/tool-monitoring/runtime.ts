/** Nur serverseitig: echte Abhängigkeiten und der Cache dieser Server-Instanz. */
import { createAdminClient } from "@/lib/supabase/admin";
import { createTtlCache } from "./cache";
import { DEFAULT_TIMEOUT_MS } from "./http";
import { supabaseConfigured } from "./providers/shared";
import { probeTls } from "./tls";
import type { MonitoringEnv, ProviderDeps, RpcFn } from "./types";

export const monitoringCache = createTtlCache();

export function createDeps(env: MonitoringEnv): ProviderDeps {
  let rpc: RpcFn | undefined;
  if (supabaseConfigured(env)) {
    rpc = async (fn, args) => {
      const { data, error } = await createAdminClient().rpc(fn, args).abortSignal(AbortSignal.timeout(DEFAULT_TIMEOUT_MS));
      return { data, error: error ? { message: error.message } : null };
    };
  }
  return {
    fetchImpl: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    now: () => new Date(),
    rpc,
    tls: probeTls,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
