import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminShell from "@/components/admin/shell/AdminShell";
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
        <div>
          <p className="text-[11px] font-medium text-[#A7AFBA] uppercase tracking-widest mb-1">Administration</p>
          <h1 className="text-2xl font-bold text-white">Audit-Log</h1>
          <p className="text-sm text-[#A7AFBA] mt-1">Alle protokollierten Admin-Aktionen über sämtliche Organisationen.</p>
        </div>
        <AuditLogView />
      </div>
      </AdminShell>
    </>
  );
}
