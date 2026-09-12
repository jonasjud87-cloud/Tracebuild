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
  // Landingpage): ein sanftes Glühen aus der Palette statt eintönigem
  // Dunkelblau — ohne Partikel.
  //
  // Bewusst ALS EIN EINZIGES `background` (mehrere Gradient-Layer + der
  // Canvas als letzter Layer) statt separater `position:fixed`-Divs: die
  // vorherige Fassung mit eigenen Blob-Elementen liess sich nicht zuverlässig
  // reproduzieren (vmax-Grössen + fixed-Positionierung + overflow:hidden auf
  // dem Wrapper ergaben je nach Seitenhöhe/Scrollposition einen Bereich, in
  // dem praktisch nichts vom Glühen ankam). Ein mehrlagiger `background` mit
  // `background-attachment: fixed` hat keine dieser Fallstricke: er deckt
  // exakt den Viewport ab, unabhängig von Seitenlänge oder Scroll-Stand.
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundImage: [
          "radial-gradient(1100px 750px at 8% 0%, rgba(79,209,255,0.28), transparent 60%)",
          "radial-gradient(1000px 750px at 100% 12%, rgba(143,179,245,0.20), transparent 60%)",
          "radial-gradient(1100px 850px at 4% 100%, rgba(198,155,240,0.18), transparent 60%)",
          "var(--tb-canvas)",
        ].join(", "),
        backgroundAttachment: "fixed",
        backgroundRepeat: "no-repeat",
      }}
    >
      {children}
    </div>
  );
}
