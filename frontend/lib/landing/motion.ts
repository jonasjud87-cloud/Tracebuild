import type { Variants, Transition } from "framer-motion";

export const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];
export const EASE_EXPO: Transition["ease"] = [0.16, 1, 0.3, 1];

/** Standard section entrance: rises + fades. Collapses to opacity-only under MotionConfig reducedMotion="user". */
export const revealUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.72, ease: EASE_OUT },
  },
};

export const revealTextLine: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

/** Parent that staggers its children. */
export function staggerParent(stagger = 0.09, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  };
}

export const cardReveal: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.72, ease: EASE_OUT },
  },
};

/** Shared viewport config so every section reveals once, ~20% in view. */
export const inView = { once: true, amount: 0.2 } as const;
