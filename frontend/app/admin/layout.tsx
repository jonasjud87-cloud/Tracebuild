import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import "@/components/admin/shell/admin-theme.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin" && user.role !== "org_admin") redirect("/dashboard");

  return <div className="tba tba-canvas">{children}</div>;
}
