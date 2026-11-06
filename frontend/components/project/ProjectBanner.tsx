import type { ReactNode } from "react";
import p from "@/app/projects/project.module.css";

const BANNER_PHOTO = "/landing/project-banner.jpg";

export interface ProjectBannerProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export default function ProjectBanner({ title, subtitle, actions }: ProjectBannerProps) {
  return (
    <section className={p.banner}>
      <div className={p.bannerPhoto} style={{ backgroundImage: `url(${BANNER_PHOTO})` }} aria-hidden="true" />
      <div className={p.bannerText}>
        <h1 className={p.bannerTitle}>{title}</h1>
        {subtitle != null && subtitle !== false && <p className={p.bannerSub}>{subtitle}</p>}
      </div>
      {actions && <div className={p.bannerActions}>{actions}</div>}
    </section>
  );
}
