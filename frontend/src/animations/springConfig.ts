/** Light spring for Zip corridor tip (axis-aligned only). */
export const LIGHT_SPRING = {
  stiffness: 380,
  damping: 28,
  mass: 0.55,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 2,
} as const;

/** Snappy settle when releasing back to the path head. */
export const SNAP_SPRING = {
  stiffness: 480,
  damping: 32,
  mass: 0.45,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 2,
} as const;
