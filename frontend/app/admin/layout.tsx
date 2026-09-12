import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

// Defense in depth: the admin area never depends on middleware alone. A member
// or project_manager is bounced even if the middleware gate is bypassed/fails.
// (super_admin sees the cockpit, org_admin reaches /admin/org.)
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin" && user.role !== "org_admin") redirect("/dashboard");

  // Selbe, ruhige Lichtstimmung wie die Ladescreen-Fläche (.tb-intro auf der
  // Landingpage): ein sanftes Glühen aus der Palette statt mehrerer bunter
  // Blobs — ohne Partikel. z-index bewusst auf -1 gesetzt (anders als
  // .tb-intro__glow, das z-index:auto nutzt und im Ladescreen keinen
  // Geschwister-Inhalt hat) — die Adminseiten haben normalen Inhalt daneben,
  // der nicht darunter verschwinden darf.
  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "var(--tb-canvas)", overflow: "hidden" }}>
      <style>{`
        @keyframes tbAdminGlowA { 0%,100%{opacity:.13;transform:translate3d(0,0,0) scale(1)} 50%{opacity:.22;transform:translate3d(6%,-4%,0) scale(1.14)} }
        @keyframes tbAdminGlowB { 0%,100%{opacity:.10;transform:translate3d(0,0,0) scale(1.05)} 50%{opacity:.17;transform:translate3d(-6%,5%,0) scale(1.16)} }
        @keyframes tbAdminGlowC { 0%,100%{opacity:.09;transform:translate3d(0,0,0) scale(1)} 50%{opacity:.15;transform:translate3d(4%,6%,0) scale(1.12)} }
      `}</style>
      <div
        aria-hidden
        style={{
          position: "fixed", zIndex: -1, pointerEvents: "none",
          width: "90vmax", height: "90vmax", left: "-30vmax", top: "-40vmax",
          background: "radial-gradient(circle,#4fd1ff 0%,transparent 70%)",
          filter: "blur(60px)", opacity: .22,
          animation: "tbAdminGlowA 22s ease-in-out -4s infinite",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed", zIndex: -1, pointerEvents: "none",
          width: "80vmax", height: "80vmax", right: "-30vmax", top: "-10vmax",
          background: "radial-gradient(circle,#8fb3f5 0%,transparent 70%)",
          filter: "blur(60px)", opacity: .16,
          animation: "tbAdminGlowB 26s ease-in-out -11s infinite",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed", zIndex: -1, pointerEvents: "none",
          width: "76vmax", height: "76vmax", left: "0vmax", bottom: "-42vmax",
          background: "radial-gradient(circle,#c69bf0 0%,transparent 70%)",
          filter: "blur(60px)", opacity: .15,
          animation: "tbAdminGlowC 29s ease-in-out -7s infinite",
        }}
      />
      {children}
    </div>
  );
}
