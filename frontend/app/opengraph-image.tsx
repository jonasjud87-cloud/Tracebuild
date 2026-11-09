import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TraceBuild - Zeichnungen prüfen, Normen einhalten";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "88px 96px",
          background: "linear-gradient(150deg, #1c1b1b 0%, #151414 55%, #121111 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #d8cebf 0%, #b5a893 100%)",
              color: "#151414",
              fontSize: 34,
              fontWeight: 800,
              borderRadius: 14,
            }}
          >
            T
          </div>
          <div style={{ color: "#ffffff", fontSize: 30, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>
            TraceBuild
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              color: "#ffffff",
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              maxWidth: 900,
            }}
          >
            Zeichnungen prüfen, Normen einhalten.
          </div>
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 30, lineHeight: 1.4, maxWidth: 820 }}>
            PDF hochladen, KI-Prüfung gegen geltende Normen, eine klare Übersicht der Befunde.
          </div>
        </div>

        <div
          style={{
            height: 6,
            width: 260,
            borderRadius: 3,
            background: "linear-gradient(135deg, #d8cebf 0%, #b5a893 100%)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
