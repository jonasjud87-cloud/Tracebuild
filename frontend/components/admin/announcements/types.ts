export type AnnouncementType = "info" | "warning" | "maintenance" | "critical";
export type AnnouncementState = "scheduled" | "live" | "expired" | "disabled";

export interface Announcement {
  id: string;
  orgId: string | null;
  orgName: string | null;
  title: string;
  message: string;
  type: AnnouncementType;
  startsAt: string;
  endsAt: string | null;
  dismissible: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdByEmail: string | null;
  state: AnnouncementState;
}

export const TYPE_OPTIONS: { value: AnnouncementType; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warnung" },
  { value: "maintenance", label: "Wartung" },
  { value: "critical", label: "Kritisch" },
];

export const TITLE_MAX = 120;
export const MESSAGE_MAX = 1000;
