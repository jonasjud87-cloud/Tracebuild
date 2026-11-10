import type { ReactNode } from "react";

type PageHeaderPhoto = "dashboard" | "haus1" | "haus2" | "haus3";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
  variant?: "hero" | "compact";
  photo?: PageHeaderPhoto;
  overlap?: boolean;
};

const PHOTOS: Record<PageHeaderPhoto, { url: string; position: string }> = {
  dashboard: { url: "/landing/dashboard-building.jpg", position: "70% 40%" },
  haus1: { url: "/landing/banner-haus-1.jpg", position: "75% 58%" },
  haus2: { url: "/landing/banner-haus-2.jpg", position: "70% 62%" },
  haus3: { url: "/landing/banner-haus-3.jpg", position: "75% 32%" },
};

export default function PageHeader({ title, subtitle, actions, eyebrow, variant = "compact", photo, overlap = true }: PageHeaderProps) {
  const hero = variant === "hero";
  const photoStyle = photo
    ? { backgroundImage: `url("${PHOTOS[photo].url}")`, backgroundPosition: PHOTOS[photo].position, transformOrigin: PHOTOS[photo].position }
    : undefined;
  const heroSpacing = overlap
    ? "mb-0 px-6 pb-28 pt-10 sm:px-10 sm:pb-32 sm:pt-12"
    : "mb-0 px-6 pb-10 pt-10 sm:px-10 sm:pb-12 sm:pt-12";
  return (
    <header
      className={`tba-rise tba-hero ${hero ? "" : "tba-hero--compact"} ${
        hero ? heroSpacing : "mb-5 px-5 py-6 sm:px-8 sm:py-8"
      }`}
    >
      <div className="tba-hero__photo" style={photoStyle} aria-hidden="true" />
      <div className="tba-hero__shade" aria-hidden="true" />
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[640px]">
          {(eyebrow || hero) && (
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-[#cbbfae]">{eyebrow ?? "Administration"}</p>
          )}
          <h1 className={`font-bold tracking-tight text-white ${hero ? "text-[32px] leading-[1.1] sm:text-[44px]" : "text-2xl sm:text-[32px] sm:leading-9"}`}>{title}</h1>
          {subtitle && <p className={`mt-2 text-white/85 ${hero ? "text-base sm:text-lg" : "text-[15px]"}`}>{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
