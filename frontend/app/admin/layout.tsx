import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

// Defense in depth: the admin area never depends on middleware alone. A member
// or project_manager is bounced even if the middleware gate is bypassed/fails.
// (super_admin sees the cockpit, org_admin reaches /admin/org.)
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  if (user.role !== "super_admin" && user.role !== "org_admin") redirect("/dashboard");

  // Selbe Lichtstimmung wie der untere Bereich der Landingpage (AmbientField):
  // mehrere Farben aus der Palette statt nur Blautöne, damit der Hintergrund
  // nicht flach/eintönig wirkt. Bewusst eigenständig statt AmbientField
  // wiederzuverwenden — dessen z-index-0-Ebene setzt voraus, dass jeder
  // Inhalt sich selbst über z-index positioniert (wie auf der Landingpage);
  // die Adminseiten tun das nicht, darum bleiben die Blobs hier auf z-index -1.
  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "linear-gradient(150deg,#0a1a24 0%,#0a1420 45%,#070b14 100%) fixed" }}>
      <style>{`@keyframes glowPulse { 0%,100%{opacity:.14;transform:scale(1)} 50%{opacity:.24;transform:scale(1.12)} }`}</style>
      <div style={{ position: "fixed", top: "-14%", left: "-12%", width: "52vw", height: "52vw", maxWidth: 760, maxHeight: 760, background: "radial-gradient(circle,#4fd1ff 0%,transparent 70%)", filter: "blur(90px)", opacity: .16, zIndex: -1, pointerEvents: "none", animation: "glowPulse 21s ease-in-out infinite" }} />
      <div style={{ position: "fixed", top: "24%", right: "-16%", width: "48vw", height: "48vw", maxWidth: 700, maxHeight: 700, background: "radial-gradient(circle,#c69bf0 0%,transparent 70%)", filter: "blur(104px)", opacity: .14, zIndex: -1, pointerEvents: "none", animation: "glowPulse 25s ease-in-out infinite", animationDelay: "-4s" }} />
      <div style={{ position: "fixed", bottom: "-18%", left: "6%", width: "58vw", height: "58vw", maxWidth: 820, maxHeight: 820, background: "radial-gradient(circle,#2862d7 0%,transparent 70%)", filter: "blur(100px)", opacity: .18, zIndex: -1, pointerEvents: "none", animation: "glowPulse 23s ease-in-out infinite", animationDelay: "-8s" }} />
      <div style={{ position: "fixed", top: "4%", left: "42%", width: "38vw", height: "38vw", maxWidth: 560, maxHeight: 560, background: "radial-gradient(circle,#8fb3f5 0%,transparent 70%)", filter: "blur(80px)", opacity: .12, zIndex: -1, pointerEvents: "none", animation: "glowPulse 18s ease-in-out infinite", animationDelay: "-12s" }} />
      <div style={{ position: "fixed", bottom: "70%", right: "8%", width: "36vw", height: "36vw", maxWidth: 520, maxHeight: 520, background: "radial-gradient(circle,#38bdf8 0%,transparent 70%)", filter: "blur(84px)", opacity: .13, zIndex: -1, pointerEvents: "none", animation: "glowPulse 26s ease-in-out infinite", animationDelay: "-16s" }} />
      {children}
    </div>
  );
}
