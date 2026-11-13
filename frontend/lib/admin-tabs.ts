export interface TabDef<T extends string> {
  id: T;
  label: string;
  hint: string;
  hash: string;
}

export function tabFromHash<T extends string>(tabs: TabDef<T>[], hash: string, fallback: T, aliases: Record<string, T> = {}): T {
  const key = hash.trim().toLowerCase();
  const direct = tabs.find((t) => t.hash === key);
  if (direct) return direct.id;
  return aliases[key] ?? fallback;
}

export function hashForTab<T extends string>(tabs: TabDef<T>[], tab: T): string {
  return tabs.find((t) => t.id === tab)?.hash ?? "";
}

export function nextTab<T extends string>(tabs: TabDef<T>[], current: T, direction: 1 | -1): T {
  const index = tabs.findIndex((t) => t.id === current);
  return tabs[(index + direction + tabs.length) % tabs.length].id;
}
