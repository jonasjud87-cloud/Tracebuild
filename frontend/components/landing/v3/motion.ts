import type { Transition } from "framer-motion";

export const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];

export const inView = { once: true, amount: 0.2 } as const;
