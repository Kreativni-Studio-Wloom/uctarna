import type { Transition } from 'framer-motion';

/** Sdílené spring presety pro Uctarna Premium */
export const springPresets = {
  /** Výchozí — košík, layout transitions */
  spring: { type: 'spring', stiffness: 500, damping: 35 } satisfies Transition,
  /** Modály, panely */
  gentle: { type: 'spring', stiffness: 300, damping: 30 } satisfies Transition,
  /** Tlačítka, rychlé interakce */
  snappy: { type: 'spring', stiffness: 700, damping: 40 } satisfies Transition,
  /** Bottom sheet otevření */
  sheet: { type: 'spring', stiffness: 400, damping: 32 } satisfies Transition,
} as const;

export const fadeSlideUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: springPresets.gentle,
} as const;

export const scaleFadeIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: springPresets.gentle,
} as const;
