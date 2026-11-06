export default function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="470 40 605 905" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="tba-mark-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F0C99A" />
          <stop offset="1" stopColor="#B07D3E" />
        </linearGradient>
      </defs>
      <path d="M475 272L783 45V730L475 938Z" fill="url(#tba-mark-gold)" />
      <path d="M857 202L1068 358V938H947V385L857 318Z" fill="#FDF6EE" />
      <path d="M513 938L783 762V938Z" fill="#FDF6EE" />
    </svg>
  );
}
