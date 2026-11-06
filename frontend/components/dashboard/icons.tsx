import type { ReactNode } from "react";

function Svg({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 11 12 3.5 20.5 11" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></Svg>
);
export const LayersIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="m3 12.5 9 5 9-5" /><path d="m3 17 9 5 9-5" /></Svg>
);
export const BookIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 6.5C10.3 5.2 7.8 4.5 4 4.5v13c3.8 0 6.3.7 8 2 1.7-1.3 4.2-2 8-2v-13c-3.8 0-6.3.7-8 2z" /><path d="M12 6.5v13" /></Svg>
);
export const UsersIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c1.7.7 3 2.3 3 5.2" /></Svg>
);
export const LogoutIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" /><path d="M10 12h10M17 8l4 4-4 4" /></Svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
);
export const DocumentIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Svg>
);
export const AlertCircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></Svg>
);
export const ShieldCheckIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3 5 6v5.5c0 4.4 2.9 7.9 7 9.5 4.1-1.6 7-5.1 7-9.5V6l-7-3z" /><path d="m9 12 2.2 2.2L15.5 10" /></Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></Svg>
);
export const ListIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" /></Svg>
);
export const BuildingIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 20V9l6-3.5V20M10 20V4l10 4v12M3 20h18" /><path d="M13 10h4M13 13.5h4M13 17h4M6.5 11v.01M6.5 14v.01M6.5 17v.01" /></Svg>
);
export const PinIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></Svg>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>
);
export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.8 2.8L16 9.5" /></Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Svg>
);
