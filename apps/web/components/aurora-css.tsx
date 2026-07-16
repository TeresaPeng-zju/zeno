/**
 * Filter-free aurora made from layered CSS gradients. A single viewport-sized
 * layer avoids the clipped edges and continuous rasterization of SVG filters.
 */
export function AuroraCss() {
  return (
    <div className="aurora-backdrop" aria-hidden="true" />
  );
}
