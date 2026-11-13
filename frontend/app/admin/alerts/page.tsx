import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminShell from "@/components/admin/shell/AdminShell";
import PageHeader from "@/components/admin/shell/PageHeader";
import AlertsView from "@/components/admin/alerts/AlertsView";

export const dynamic = "force-dynamic";

export default async function AdminAlertsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role === "org_admin") redirect("/admin/org");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <AdminShell userEmail={user.email}>
      <div className="space-y-6">
        <PageHeader photo="haus1" eyebrow="Administration" title="Meldungen" subtitle="Alle Meldungen der Glocke. Archivieren blendet sie aus, Löschen entfernt sie aus der Übersicht." />
        <AlertsView />
      </div>
    </AdminShell>
  );
}
