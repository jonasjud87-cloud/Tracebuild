"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AnnouncementBanner from "@/components/announcements/AnnouncementBanner";
import ProjectFrame from "@/components/project/ProjectFrame";
import { OerebSyncProvider, OerebSyncStatus } from "@/components/useOerebDocumentSync";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const pathname = usePathname();
  const [meta, setMeta] = useState<{ name: string | null; number: string | null }>({ name: null, number: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/projects/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        const num = j.data.project_number;
        setMeta({ name: j.data.name ?? null, number: num != null && num !== "" ? String(num) : null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [params.id, pathname]);

  return (
    <ProjectFrame projectId={params.id} pathname={pathname} projectName={meta.name} projectNumber={meta.number} announcements={<AnnouncementBanner />}>
      <OerebSyncProvider projectId={params.id}>
        <OerebSyncStatus projectId={params.id} />
        {children}
      </OerebSyncProvider>
    </ProjectFrame>
  );
}
