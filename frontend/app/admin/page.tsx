import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminShell from "@/components/admin/shell/AdminShell";
import OverviewDashboard from "@/components/admin/overview/OverviewDashboard";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams?: { org?: string; tab?: string };
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role === "org_admin") redirect("/admin/org");
  if (user.role !== "super_admin") redirect("/dashboard");

  const org = searchParams?.org;
  if (org) {
    const query = new URLSearchParams({ org });
    if (searchParams?.tab) query.set("tab", searchParams.tab);
    redirect(`/admin/manage?${query.toString()}`);
  }

  return (
    <AdminShell userEmail={user.email}>
      <OverviewDashboard />
    </AdminShell>
  );
}
