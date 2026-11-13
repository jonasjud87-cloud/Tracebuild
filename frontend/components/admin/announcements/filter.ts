import type { Announcement, AnnouncementState, AnnouncementType } from "./types";

export const ALL_USERS = "__all_users__";

export interface AnnouncementFilter {
  query: string;
  state: AnnouncementState | "all";
  type: AnnouncementType | "all";
  audience: string;
}

export const EMPTY_FILTER: AnnouncementFilter = { query: "", state: "all", type: "all", audience: "all" };

export function isFiltered(f: AnnouncementFilter): boolean {
  return f.query.trim() !== "" || f.state !== "all" || f.type !== "all" || f.audience !== "all";
}

export function audienceOf(a: Announcement): string {
  return a.orgId ?? ALL_USERS;
}

export function audienceOptions(items: Announcement[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  items.forEach(a => {
    if (a.orgId && !seen.has(a.orgId)) seen.set(a.orgId, a.orgName ?? "Organisation");
  });
  const orgs: { value: string; label: string }[] = [];
  seen.forEach((label, value) => orgs.push({ value, label }));
  orgs.sort((x, y) => x.label.localeCompare(y.label, "de"));
  return [{ value: ALL_USERS, label: "Alle Nutzer" }].concat(orgs);
}

export function filterAnnouncements(items: Announcement[], f: AnnouncementFilter): Announcement[] {
  const q = f.query.trim().toLowerCase();
  return items.filter(a => {
    if (f.state !== "all" && a.state !== f.state) return false;
    if (f.type !== "all" && a.type !== f.type) return false;
    if (f.audience !== "all" && audienceOf(a) !== f.audience) return false;
    if (!q) return true;
    const haystack = [a.title, a.message, a.orgName ?? "", a.createdByEmail ?? ""].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}
