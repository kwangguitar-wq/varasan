import type { CSSProperties, ReactNode } from 'react';

/** Peak bend (degrees) between the spine edge and the free edge of a turning page. */
const MAX_CURL = 34;

export interface CurlLeafProps {
  /** Overall rotation of the free edge about the spine, 0 … -180 degrees. */
  angle: number;
  /** +1 when the page travels toward the spine on the right, -1 when it comes back. */
  dir: 1 | -1;
  /** Paper stiffness: how far the trailing edge falls behind the free edge. */
  bend: number;
  width: number;
  height: number;
  front: ReactNode;
  back: ReactNode;
  /** A stiff cover turns as one flat sheet instead of curling. */
  flat?: boolean;
  edge?: 'right' | 'single';
  className?: string;
  style?: CSSProperties;
  frontClass?: string;
  backClass?: string;
  ariaLabel?: string;
  role?: string;
  ariaHidden?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

function clamp(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, value));
}

function stripCountFor(width: number) {
  return clamp(10, 20, Math.round(width / 30));
}

/** How much the sheet bows at this angle: none when flat, most mid-turn. */
export function curlBend(angle: number) {
  const progress = clamp(0, 1, Math.abs(angle) / 180);
  return MAX_CURL * Math.sin(Math.PI * progress);
}

/**
 * Head light on paper: a sheet facing the reader reads bright, and turns grey as it
 * swings edge-on. One flat tone per strip (no gradient inside a strip) keeps the
 * shading continuous: consecutive strips differ by about one 8-bit level, so the
 * curvature reads as light falling off instead of as bands.
 */
function shade(alpha: number) {
  const facing = Math.abs(Math.cos((alpha * Math.PI) / 180));
  return Math.round((1 - facing) * 32) / 100;
}

/** Cosine of the sheet's yaw at a point, i.e. how wide that slice projects. */
function foreshorten(alpha: number) {
  return Math.cos((alpha * Math.PI) / 180);
}

interface Strip {
  k: number;
  x: number;
  z: number;
  alpha: number;
  nextAlpha: number;
}

/**
 * The sheet turns around its middle and bows symmetrically: the free edge leads, the
 * spine edge trails, so paper lifts off the page it is leaving and settles on the one
 * it is arriving at. Each strip pivots a little further than the previous one, so the
 * sheet curves like paper instead of swivelling as a plate.
 *
 * Strip positions are chained (strip k starts where strip k-1 ends) so the sheet never
 * tears, and the bow is clamped so no edge ever crosses the plane of a page — the spine
 * edge stays inside the gutter and the free edge never swings behind the book.
 */
function buildStrips(angle: number, dir: number, bend: number, width: number, count: number): Strip[] {
  const limit = 2 * Math.min(Math.abs(angle), 180 - Math.abs(angle));
  const delta = Math.min(bend, limit * 0.9);
  const step = width / count;
  const strips: Strip[] = [];
  let x = 0;
  let z = 0;
  for (let k = 0; k < count; k += 1) {
    const from = count > 1 ? 0.5 - k / (count - 1) : 0;
    const to = count > 1 ? 0.5 - (k + 1) / (count - 1) : 0;
    const alpha = angle + dir * delta * from;
    const nextAlpha = angle + dir * delta * to;
    strips.push({ k, x, z, alpha, nextAlpha });
    const rad = (alpha * Math.PI) / 180;
    x += step * Math.cos(rad);
    z += -step * Math.sin(rad);
  }
  return strips;
}

/**
 * Where the bent sheet ends up: its projected width from the spine and how far its
 * lifted part stands off the page. Used for the shadow the turning page throws.
 */
export function curlMetrics(angle: number, dir: 1 | -1, bend: number, width: number) {
  const strips = buildStrips(angle, dir, bend, width, stripCountFor(width));
  let span = 0;
  let lift = 0;
  for (const strip of strips) {
    const step = width / strips.length;
    span += step * foreshorten(strip.alpha);
    lift = Math.max(lift, strip.z);
  }
  return { span: Math.abs(span), lift };
}

export function CurlLeaf({
  angle,
  dir,
  bend,
  width,
  height,
  front,
  back,
  flat = false,
  edge = 'right',
  className = '',
  style,
  frontClass = '',
  backClass = '',
  ariaLabel,
  role,
  ariaHidden,
  onClick,
}: CurlLeafProps) {
  const count = flat ? 1 : stripCountFor(width);
  const strips = buildStrips(angle, flat ? 1 : dir, flat ? 0 : bend, width, count);
  const step = width / count;

  return (
    <div
      className={`book-leaf ${className}`.trim()}
      style={style}
      aria-label={ariaLabel}
      role={role}
      aria-hidden={ariaHidden}
      onClick={onClick}
    >
      {flat ? (
        <>
          <div className="book-curl-strip" style={{ width, height, top: 0, left: 0 }}>
            <div className={`book-leaf-face book-leaf-front is-${edge} ${frontClass}`.trim()}>
              <div className="book-page-body">{front}</div>
            </div>
            <div
              className={`book-leaf-face book-leaf-back is-${edge === 'single' ? 'single' : 'left'} ${backClass}`.trim()}
            >
              <div className="book-page-body">{back}</div>
            </div>
          </div>
        </>
      ) : (
        strips.map((strip) => {
          // Each slice is squashed across the spine axis by its own yaw. Working in the
          // projected plane (no perspective) keeps neighbouring slices exactly edge to
          // edge, so the sheet stays a smooth curve instead of a flight of steps.
          const yaw = foreshorten(strip.alpha);
          const facingFront = yaw >= 0;
          const tone = shade(facingFront ? strip.alpha : strip.alpha + 180);
          const marks = `${strip.k === 0 ? ' is-first' : ''}${strip.k === count - 1 ? ' is-last' : ''}`;
          return (
            <div
              className={`book-curl-strip${marks}`}
              key={strip.k}
              style={{
                // A hair of overlap keeps subpixel edges from showing as hairlines; the
                // next slice paints over it with the same paper and content.
                left: strip.x - 0.6,
                top: 0,
                width: step + 1.8,
                height,
                transform: `scaleX(${yaw})`,
              }}
            >
              {facingFront ? (
                <div className={`book-curl-face book-curl-front ${frontClass}`.trim()}>
                  <div className="book-curl-slice" style={{ width, height, left: -strip.k * step }}>
                    <div className="book-page-body">{front}</div>
                  </div>
                  <span
                    className="book-curl-tint"
                    style={{ background: `rgba(10, 14, 20, ${tone})` }}
                    aria-hidden="true"
                  />
                </div>
              ) : (
                <div className={`book-curl-face book-curl-back ${backClass}`.trim()}>
                  <div className="book-curl-slice" style={{ width, height, left: (strip.k + 1) * step - width }}>
                    <div className="book-page-body">{back}</div>
                  </div>
                  <span
                    className="book-curl-tint"
                    style={{ background: `rgba(10, 14, 20, ${tone})` }}
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
