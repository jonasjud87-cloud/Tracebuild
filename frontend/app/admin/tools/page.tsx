import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminShell from "@/components/admin/shell/AdminShell";
import ToolMonitor from "@/components/admin/tools/ToolMonitor";

export const dynamic = "force-dynamic";

export default async function AdminToolsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <AdminShell userEmail={user.email}>
      <ToolMonitor />
    </AdminShell>
  );
}
