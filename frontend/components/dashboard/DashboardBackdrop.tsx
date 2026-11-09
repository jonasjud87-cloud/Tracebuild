import s from "@/app/dashboard/dashboard.module.css";

const BACKDROP_PHOTO = "/landing/dashboard-building.jpg";

export default function DashboardBackdrop() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <div className={s.photo} style={{ backgroundImage: `url(${BACKDROP_PHOTO})` }} />
      <div className={s.shade} />
    </div>
  );
}
