export default function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#151414 fixed" }}>
      {children}
    </div>
  );
}
