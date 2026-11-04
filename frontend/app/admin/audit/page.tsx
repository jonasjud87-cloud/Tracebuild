import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminNav from "@/components/admin/AdminNav";
import AuditLogView from "@/components/admin/audit/AuditLogView";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role === "org_admin") redirect("/admin/org");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <>
      <AdminNav userEmail={user.email} />
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <p className="text-[11px] font-medium text-[#7B8299] uppercase tracking-widest mb-1">Administration</p>
          <h1 className="text-2xl font-bold text-white">Audit-Log</h1>
          <p className="text-sm text-[#ABAEBB] mt-1">Alle protokollierten Admin-Aktionen über sämtliche Organisationen.</p>
        </div>
        <AuditLogView />
      </main>
    </>
  );
}
