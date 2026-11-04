import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import AdminNav from "@/components/admin/AdminNav";
import AnalysesMonitor from "@/components/admin/analyses/AnalysesMonitor";

export const dynamic = "force-dynamic";

export default async function AdminAnalysesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <>
      <AdminNav userEmail={user.email} />
      <AnalysesMonitor />
    </>
  );
}
