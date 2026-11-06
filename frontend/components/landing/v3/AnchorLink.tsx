"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useLenis } from "./SmoothScrollProvider";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: `#${string}`; offsite?: boolean };

export default function AnchorLink({ href, offsite, onClick, children, ...rest }: Props) {
  const { lenis } = useLenis();

  if (offsite) {
    return (
      <Link href={`/${href}`} onClick={onClick} {...rest}>
        {children}
      </Link>
    );
  }

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const isTop = href === "#top";
    const target = isTop ? document.body : document.querySelector<HTMLElement>(href);
    if (!target) return;
    e.preventDefault();
    if (lenis) {
      if (isTop) lenis.scrollTo(0);
      else lenis.scrollTo(target);
    } else if (isTop) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    history.replaceState(null, "", href);
  }

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
