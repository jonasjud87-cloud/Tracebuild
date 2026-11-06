export default function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "linear-gradient(150deg,#0B1220 0%,#0B1220 45%,#080D16 100%) fixed" }}>
      {children}
    </div>
  );
}
