"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  label: string;
  href: string;
  path: string;
  view?: string;
  exact?: boolean;
  icon: ReactNode;
};

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const PLATFORM_ITEMS: NavItem[] = [
  {
    label: "Übersicht",
    href: "/admin",
    path: "/admin",
    exact: true,
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
      </svg>
    ),
  },
  {
    label: "Analysen",
    href: "/admin/analyses",
    path: "/admin/analyses",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 4v16h16" />
        <path d="M8 15l3-4 3 2 5-6" />
      </svg>
    ),
  },
  {
    label: "Organisationen",
    href: "/admin/manage?view=Betrieb",
    path: "/admin/manage",
    view: "Betrieb",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
        <path d="M16 5.2a3 3 0 010 5.6M18 14c1.8.7 3 2.3 3 5" />
      </svg>
    ),
  },
  {
    label: "Nutzer",
    href: "/admin/manage?view=Support",
    path: "/admin/manage",
    view: "Support",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
      </svg>
    ),
  },
  {
    label: "Kosten & Abrechnung",
    href: "/admin/manage?view=Finanzen",
    path: "/admin/manage",
    view: "Finanzen",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="6" width="18" height="13" rx="2.5" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </svg>
    ),
  },
];

const ADMIN_ITEMS: NavItem[] = [
  {
    label: "Normen & Richtlinien",
    href: "/admin/norms",
    path: "/admin/norms",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M6 3.5h12a1 1 0 011 1V21l-7-3.5L5 21V4.5a1 1 0 011-1z" />
        <path d="M9 8h6M9 11.5h6" />
      </svg>
    ),
  },
  {
    label: "ÖREB-Importe",
    href: "/admin/oereb-imports",
    path: "/admin/oereb-imports",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M7 3.5h7l4 4V20.5H7z" />
        <path d="M14 3.5v4h4M10 12h5M10 15.5h5" />
      </svg>
    ),
  },
  {
    label: "Ankündigungen",
    href: "/admin/announcements",
    path: "/admin/announcements",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 10v4h3l7 4V6L7 10H4z" />
        <path d="M17.5 9.5a3.5 3.5 0 010 5" />
      </svg>
    ),
  },
  {
    label: "Logs & Monitoring",
    href: "/admin/audit",
    path: "/admin/audit",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
      </svg>
    ),
  },
];

function NavGroup({
  title,
  items,
  pathname,
  view,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  view: string | null;
  onNavigate: () => void;
}) {
  const headingId = `tb-nav-${title}`;
  return (
    <div>
      <p id={headingId} className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--tba-text-2,#A7AFBA)]">
        {title}
      </p>
      <ul aria-labelledby={headingId} className="space-y-1">
        {items.map(item => {
          const pathMatch = item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(`${item.path}/`);
          const active = item.view ? pathMatch && (view ?? "Betrieb") === item.view : pathMatch;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`tba-nav-link flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "tba-nav-active font-semibold"
                    : "text-[var(--tba-text,#F4F3F0)]"
                }`}
              >
                <span className={active ? "text-[var(--tba-cream,#FDF6EE)]" : "text-[var(--tba-text-2,#A7AFBA)]"}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") ?? null;

  return (
    <nav aria-label="Admin-Navigation" className="space-y-6">
      <NavGroup title="Plattform" items={PLATFORM_ITEMS} pathname={pathname} view={view} onNavigate={onNavigate} />
      <NavGroup title="Admin" items={ADMIN_ITEMS} pathname={pathname} view={view} onNavigate={onNavigate} />
    </nav>
  );
}
