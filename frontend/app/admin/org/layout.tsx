export default function OrgAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", position: "relative", background: "#f6f3ee" }}>
      {children}
    </div>
  );
}
