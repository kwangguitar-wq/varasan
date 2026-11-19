import type { CSSProperties, ReactNode } from 'react';

export interface CurlLeafProps {
  /** Overall rotation of the sheet about the spine, 0 … -180 degrees. */
  angle: number;
  /** Vertical point where the reader is holding the paper (0 top, 1 bottom). */
  curlY?: number;
  width: number;
  height: number;
  front: ReactNode;
  back: ReactNode;
  edge?: 'right' | 'single';
  className?: string;
  style?: CSSProperties;
  frontClass?: string;
  backClass?: string;
  /** Darkens the sheet as it swings edge-on, the way paper loses the light. */
  shaded?: boolean;
  ariaLabel?: string;
  role?: string;
  ariaHidden?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * How dark the sheet is at this angle: clear while it faces the reader, deepest
 * when it stands edge-on. Only an opacity is returned, so the browser can fade
 * a plain gradient instead of repainting the page every frame.
 */
export function leafShade(angle: number) {
  const rad = (Math.max(-180, Math.min(180, angle)) * Math.PI) / 180;
  const tilt = Math.abs(Math.sin(rad));
  return Math.min(0.55, 0.05 + tilt * 0.45);
}

/**
 * One sheet of paper: a front face and a back face joined at the spine, rotated
 * as a single element. The parent supplies the rotation, so a turn is one
 * composited transform — no per-frame geometry, no repainting the page content.
 */
export function CurlLeaf({
  angle,
  curlY = 0.78,
  width,
  height,
  front,
  back,
  edge = 'right',
  className = '',
  style,
  frontClass = '',
  backClass = '',
  shaded = false,
  ariaLabel,
  role,
  ariaHidden,
  onClick,
}: CurlLeafProps) {
  const shade = shaded ? leafShade(angle) : 0;
  const progress = Math.min(1, Math.abs(angle) / 180);
  const bend = Math.sin(progress * Math.PI) * (0.18 + Math.abs(curlY - 0.5) * 0.34);
  const curlStyle = {
    '--curl-y': `${curlY * 100}%`,
    '--curl-progress': progress,
    '--curl-bend': bend,
    '--curl-shadow': Math.min(0.72, 0.12 + bend * 1.4),
  } as CSSProperties;

  return (
    <div
      className={`book-leaf ${className}`.trim()}
      style={{ width, height, ...curlStyle, ...style }}
      aria-label={ariaLabel}
      role={role}
      aria-hidden={ariaHidden}
      onClick={onClick}
    >
      <div className={`book-leaf-face book-leaf-front is-${edge} ${frontClass}`.trim()}>
        <div className="book-page-body">{front}</div>
        {shaded ? (
          <>
            <span className="book-leaf-shade" style={{ opacity: shade }} aria-hidden="true" />
            <span className="book-leaf-curl-light" aria-hidden="true" />
          </>
        ) : null}
      </div>
      <div
        className={`book-leaf-face book-leaf-back is-${edge === 'single' ? 'single' : 'left'} ${backClass}`.trim()}
      >
        <div className="book-page-body">{back}</div>
        {shaded ? (
          <>
            <span className="book-leaf-shade" style={{ opacity: shade }} aria-hidden="true" />
            <span className="book-leaf-curl-light is-back" aria-hidden="true" />
          </>
        ) : null}
      </div>
    </div>
  );
}
