"use client";

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

  return (
    <ProjectFrame projectId={params.id} pathname={pathname} announcements={<AnnouncementBanner />}>
      <OerebSyncProvider projectId={params.id}>
        <OerebSyncStatus projectId={params.id} />
        {children}
      </OerebSyncProvider>
    </ProjectFrame>
  );
}
