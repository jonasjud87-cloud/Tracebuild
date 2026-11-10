import type { ReactNode } from "react";
import p from "@/app/projects/project.module.css";

const PHOTOS = {
  haus1: { url: "/landing/banner-haus-1.jpg", position: "right 58%" },
  haus2: { url: "/landing/banner-haus-2.jpg", position: "right 62%" },
  haus3: { url: "/landing/banner-haus-3.jpg", position: "right 30%" },
} as const;

export type ProjectBannerVariant = "analysis" | "norms" | "standards" | "chat" | "normenblatt" | "settings";

const VARIANT_PHOTO: Record<ProjectBannerVariant, keyof typeof PHOTOS> = {
  analysis: "haus3",
  norms: "haus1",
  standards: "haus2",
  chat: "haus2",
  normenblatt: "haus3",
  settings: "haus1",
};

export interface ProjectBannerProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  variant?: ProjectBannerVariant;
}

export default function ProjectBanner({ title, subtitle, actions, variant = "norms" }: ProjectBannerProps) {
  const photo = PHOTOS[VARIANT_PHOTO[variant]];
  return (
    <section className={p.banner}>
      <div
        className={p.bannerPhoto}
        style={{ backgroundImage: `url(${photo.url})`, backgroundPosition: photo.position }}
        aria-hidden="true"
      />
      <div className={p.bannerText}>
        <h1 className={p.bannerTitle}>{title}</h1>
        {subtitle != null && subtitle !== false && <p className={p.bannerSub}>{subtitle}</p>}
      </div>
      {actions && <div className={p.bannerActions}>{actions}</div>}
    </section>
  );
}
