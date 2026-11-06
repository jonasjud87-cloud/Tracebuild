import s from "@/app/dashboard/dashboard.module.css";

const BACKDROP_PHOTO = "/landing/dashboard-building.jpg";

export default function DashboardBackdrop() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <div className={s.glowA} />
      <div className={s.glowB} />
      <div className={s.glowC} />
      <div className={s.arch}>
        <div className={s.photo} style={{ backgroundImage: `url(${BACKDROP_PHOTO})` }} />
      </div>
      <div className={s.blueprint}>
        <svg viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice">
          <defs>
            <pattern id="dbGrid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="#07142b" strokeWidth="0.8" />
            </pattern>
          </defs>
          <rect width="1600" height="420" fill="url(#dbGrid)" opacity="0.5" />
          <g fill="none" stroke="#07142b" strokeWidth="1.4">
            <path d="M120 400V250H520V400M200 400V310H330V400M520 330H760V400M760 250V400M900 400V230L1160 170V400" />
            <path d="M1160 170H1500V400M1240 400V280H1400V400" />
            <circle cx="330" cy="310" r="64" />
            <path d="M330 246V374M266 310H394" strokeDasharray="6 6" />
            <path d="M120 230H520M900 210L1160 150" strokeDasharray="10 5" />
            <path d="M600 120L1000 360M640 120L1040 360" strokeWidth="0.8" />
          </g>
        </svg>
      </div>
    </div>
  );
}
