import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminShell from "@/components/admin/shell/AdminShell";
import PageHeader from "@/components/admin/shell/PageHeader";
import AuditLogView from "@/components/admin/audit/AuditLogView";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role === "org_admin") redirect("/admin/org");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <>
      <AdminShell userEmail={user.email}>
      <div className="space-y-6">
        <PageHeader eyebrow="Administration" title="Audit-Log" subtitle="Alle protokollierten Admin-Aktionen über sämtliche Organisationen." />
        <AuditLogView />
      </div>
      </AdminShell>
    </>
  );
}
