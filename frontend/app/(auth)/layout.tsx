import { jakarta as font } from "@/lib/fonts";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.shell} ${font.className}`}>
      <svg
        className={styles.art}
        viewBox="0 0 1792 878"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="authArcL" gradientUnits="userSpaceOnUse" x1="-40" y1="0" x2="640" y2="0">
            <stop offset="0" stopColor="#CBBFAE" stopOpacity="1" />
            <stop offset="0.55" stopColor="#B5A893" stopOpacity="0.55" />
            <stop offset="1" stopColor="#9C8F7B" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="authArcR" gradientUnits="userSpaceOnUse" x1="980" y1="0" x2="1830" y2="0">
            <stop offset="0" stopColor="#9C8F7B" stopOpacity="0" />
            <stop offset="0.5" stopColor="#B5A893" stopOpacity="0.5" />
            <stop offset="1" stopColor="#CBBFAE" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="authBloom" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#CBBFAE" stopOpacity="0.14" />
            <stop offset="1" stopColor="#CBBFAE" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="authBloomL" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#CBBFAE" stopOpacity="0.16" />
            <stop offset="1" stopColor="#CBBFAE" stopOpacity="0" />
          </radialGradient>
          <filter id="authBlur" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
        </defs>
        <ellipse cx="1560" cy="660" rx="480" ry="220" fill="url(#authBloom)" />
        <ellipse cx="40" cy="430" rx="340" ry="150" fill="url(#authBloomL)" />
        <g className={styles.glow}>
          <path
            d="M-40 450 C 180 400 380 345 640 316"
            fill="none"
            stroke="url(#authArcL)"
            strokeWidth="22"
            strokeLinecap="round"
            filter="url(#authBlur)"
            opacity="1"
          />
          <path
            d="M980 835 C 1300 800 1600 700 1830 575"
            fill="none"
            stroke="url(#authArcR)"
            strokeWidth="22"
            strokeLinecap="round"
            filter="url(#authBlur)"
            opacity="1"
          />
        </g>
        <path
          d="M-40 450 C 180 400 380 345 640 316"
          fill="none"
          stroke="url(#authArcL)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M980 835 C 1300 800 1600 700 1830 575"
          fill="none"
          stroke="url(#authArcR)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <div className={styles.slot}>{children}</div>
    </div>
  );
}
