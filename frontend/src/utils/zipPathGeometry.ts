/**
 * Zip-style tip helpers (UI-thread / worklet safe).
 *
 * LinkedIn Zip draws one continuous orthogonal stroke through cell centers.
 * The live tip may only extend along the row or column from the path head —
 * never diagonally across the board.
 */

/** Project finger onto the dominant H/V axis from the path head, capped to one cell. */
export function projectOrthogonalTip(
  headX: number,
  headY: number,
  fingerX: number,
  fingerY: number,
  maxReach: number,
): { x: number; y: number } {
  'worklet';
  const dx = fingerX - headX;
  const dy = fingerY - headY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const clamped = Math.max(-maxReach, Math.min(maxReach, dx));
    return { x: headX + clamped, y: headY };
  }

  const clamped = Math.max(-maxReach, Math.min(maxReach, dy));
  return { x: headX, y: headY + clamped };
}

/** Build SVG `d` for an orthogonal polyline through cell centers. */
export function buildCellCenterPathD(
  cells: Array<{ row: number; col: number }>,
  cellSize: number,
): string {
  if (cells.length === 0) {
    return '';
  }
  const x0 = (cells[0].col + 0.5) * cellSize;
  const y0 = (cells[0].row + 0.5) * cellSize;
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < cells.length; i++) {
    const x = (cells[i].col + 0.5) * cellSize;
    const y = (cells[i].row + 0.5) * cellSize;
    d += ` L ${x} ${y}`;
  }
  return d;
}
