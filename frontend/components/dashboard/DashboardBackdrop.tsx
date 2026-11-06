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
    </div>
  );
}
