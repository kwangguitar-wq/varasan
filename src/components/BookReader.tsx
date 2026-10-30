import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icons';
import { CurlLeaf } from './CurlLeaf';
import { playPageTurn } from '../lib/paperSound';

/** Slow enough to read as paper being lifted, not as a screen flip. */
const TURN_MS = 1800;
const COVER_MS = 1400;
const HINT_KEY = 'nakhonmaesot-book-hint';

export interface BookMeta {
  publisher?: string | null;
  year?: number | null;
  category?: string | null;
  pages?: number;
}

interface BookReaderProps {
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  meta?: BookMeta;
  total: number;
  page: number;
  pageWidth: number;
  pageHeight: number;
  spread: boolean;
  renderPage: (page: number) => ReactNode;
  showCover: boolean;
  onOpenCover: () => void;
  onPage: (page: number) => void;
}

interface SpreadInfo {
  left: number | null;
  right: number | null;
  index: number;
}

interface TurnPlan {
  dir: 'next' | 'prev';
  baseLeft: number | null;
  baseRight: number | null;
  front: number | null;
  back: number | null;
  toPage: number;
}

interface Leaf {
  plan: TurnPlan;
  angle: number;
}

type Phase = 'closed' | 'opening' | 'gone';

/** A real book shows page 1 alone on the right, then pairs (2,3), (4,5) … */
function spreadFor(page: number, total: number, spread: boolean): SpreadInfo {
  if (total <= 0) return { left: null, right: null, index: 0 };
  const current = Math.min(total, Math.max(1, page));
  if (!spread) return { left: null, right: current, index: current - 1 };
  if (current <= 1) return { left: null, right: 1, index: 0 };
  const index = Math.floor(current / 2);
  const left = index * 2;
  const right = left + 1;
  return { left, right: right <= total ? right : null, index };
}

function planTurn(dir: 'next' | 'prev', page: number, total: number, spread: boolean): TurnPlan | null {
  const info = spreadFor(page, total, spread);
  if (!spread) {
    if (dir === 'next') {
      if (page >= total) return null;
      return { dir, baseLeft: null, baseRight: page + 1, front: page, back: page + 1, toPage: page + 1 };
    }
    if (page <= 1) return null;
    return { dir, baseLeft: null, baseRight: page - 1, front: page - 1, back: page, toPage: page - 1 };
  }
  if (dir === 'next') {
    if (info.right == null || info.right >= total) return null;
    const back = info.right + 1;
    const nextRight = info.right + 2;
    return {
      dir,
      baseLeft: info.left,
      baseRight: nextRight <= total ? nextRight : null,
      front: info.right,
      back,
      toPage: back,
    };
  }
  if (info.left == null) return null;
  const baseLeft = info.left - 2;
  const newRight = info.left - 1;
  return {
    dir,
    baseLeft: baseLeft >= 1 ? baseLeft : null,
    baseRight: newRight,
    front: newRight,
    back: info.left,
    toPage: baseLeft >= 1 ? baseLeft : 1,
  };
}

/** Cubic-bezier easing solved with Newton–Raphson, matching the CSS curves. */
function bezierEase(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-4) break;
      const slope = sampleDX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return sampleY(t);
  };
}

/** Gentle in-and-out: the sheet stays visible while it curls, instead of whipping past edge-on. */
const turnEase = bezierEase(0.44, 0.04, 0.3, 1);
const coverEase = bezierEase(0.33, 0.05, 0.2, 1);

type RafSlot = { current: number | null };

/** A frame-by-frame tween; CSS transitions cannot animate a per-frame curl geometry. */
function startTween(
  slot: RafSlot,
  from: number,
  to: number,
  duration: number,
  ease: (x: number) => number,
  apply: (value: number) => void,
  done?: () => void,
) {
  stopTween(slot);
  const started = performance.now();
  const step = (now: number) => {
    const t = duration <= 0 ? 1 : Math.min(1, (now - started) / duration);
    apply(from + (to - from) * ease(t));
    if (t < 1) {
      slot.current = requestAnimationFrame(step);
      return;
    }
    // One extra frame so the final position is painted before the leaf disappears.
    slot.current = requestAnimationFrame(() => {
      slot.current = null;
      done?.();
    });
  };
  slot.current = requestAnimationFrame(step);
}

function stopTween(slot: RafSlot) {
  if (slot.current !== null) {
    cancelAnimationFrame(slot.current);
    slot.current = null;
  }
}

const PageContent = memo(
  function PageContent({ page, render }: { page: number; render: (page: number) => ReactNode }) {
    return <>{render(page)}</>;
  },
  (prev, next) => prev.page === next.page && prev.render === next.render,
);

export function BookReader({
  title,
  author,
  coverUrl,
  meta,
  total,
  page,
  pageWidth,
  pageHeight,
  spread,
  renderPage,
  showCover,
  onOpenCover,
  onPage,
}: BookReaderProps) {
  const [leaf, setLeaf] = useState<Leaf | null>(null);
  const [phase, setPhase] = useState<Phase>(showCover ? 'closed' : 'gone');
  const [coverAngle, setCoverAngle] = useState(0);
  const [hint, setHint] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const turnRaf = useRef<number | null>(null);
  const coverRaf = useRef<number | null>(null);
  const drag = useRef<{
    startX: number;
    startY: number;
    plan: TurnPlan;
    active: boolean;
    angle: number;
    pointerId: number;
  } | null>(null);
  const lastDragEnd = useRef(0);
  const leafRef = useRef<Leaf | null>(null);
  const covered = phase !== 'gone';

  useEffect(() => {
    leafRef.current = leaf;
  }, [leaf]);

  useEffect(
    () => () => {
      stopTween(turnRaf);
      stopTween(coverRaf);
    },
    [],
  );

  // Cover state follows the prop, so the reader can re-open the cover on demand.
  useEffect(() => {
    if (showCover) {
      stopTween(turnRaf);
      setLeaf(null);
      setCoverAngle(0);
      setPhase('closed');
      return;
    }
    setPhase((current) => (current === 'gone' ? 'gone' : 'opening'));
  }, [showCover]);

  // Opening the cover: the sheet swings on its spine while the scene settles behind it.
  useEffect(() => {
    if (phase !== 'opening') return;
    setCoverAngle(0);
    playPageTurn(1);
    startTween(coverRaf, 0, -180, COVER_MS, coverEase, setCoverAngle, () => setPhase('gone'));
    return () => stopTween(coverRaf);
  }, [phase]);

  const finishTurn = useCallback(
    (plan: TurnPlan, angle: number) => {
      const rest = Math.abs(plan.dir === 'next' ? angle : angle + 180) / 180;
      const duration = Math.max(260, Math.round(TURN_MS * Math.min(1, 0.3 + rest)));
      playPageTurn(plan.dir === 'next' ? 1 : -1);
      const to = plan.dir === 'next' ? -180 : 0;
      startTween(turnRaf, angle, to, duration, turnEase, (value) => setLeaf({ plan, angle: value }), () => {
        setLeaf(null);
        onPage(plan.toPage);
      });
    },
    [onPage],
  );

  const finishTurnBack = useCallback((plan: TurnPlan, angle: number) => {
    const to = plan.dir === 'next' ? 0 : -180;
    playPageTurn(-1);
    startTween(turnRaf, angle, to, 420, turnEase, (value) => setLeaf({ plan, angle: value }), () => setLeaf(null));
  }, []);

  const startTurn = useCallback(
    (dir: 'next' | 'prev') => {
      if (covered || leafRef.current) return;
      const plan = planTurn(dir, page, total, spread);
      if (!plan) return;
      playPageTurn(dir === 'next' ? 1 : -1);
      const from = dir === 'next' ? 0 : -180;
      const to = dir === 'next' ? -180 : 0;
      setLeaf({ plan, angle: from });
      // Paint the sheet lying flat for a couple of frames first, so rasterising the
      // strip layers never lands inside the animation and stutters its first step.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (leafRef.current?.plan !== plan) return;
          startTween(turnRaf, from, to, TURN_MS, turnEase, (value) => setLeaf({ plan, angle: value }), () => {
            setLeaf(null);
            onPage(plan.toPage);
          });
        });
      });
    },
    [covered, onPage, page, spread, total],
  );

  const cancelDrag = useCallback(() => {
    const dragState = drag.current;
    drag.current = null;
    if (!dragState?.active) return;
    finishTurnBack(dragState.plan, dragState.angle);
  }, [finishTurnBack]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (covered || leafRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const forward = spread ? x > rect.width / 2 : x > rect.width * 0.32;
    const plan = planTurn(forward ? 'next' : 'prev', page, total, spread);
    if (!plan) return;
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      plan,
      active: false,
      angle: plan.dir === 'next' ? 0 : -180,
      pointerId: event.pointerId,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.active) {
      if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        drag.current = null;
        return;
      }
      state.active = true;
      stageRef.current?.setPointerCapture(event.pointerId);
    }
    const unit = pageWidth || 1;
    const raw = state.plan.dir === 'next' ? (dx / unit) * 200 : 180 + (dx / unit) * 200;
    state.angle = Math.max(-180, Math.min(0, raw));
    setLeaf({ plan: state.plan, angle: state.angle });
  };

  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (!state.active) return;
    lastDragEnd.current = performance.now();
    const completed = state.plan.dir === 'next' ? state.angle < -68 : state.angle > -112;
    if (completed) finishTurn(state.plan, state.angle);
    else finishTurnBack(state.plan, state.angle);
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (covered || leafRef.current) return;
    if (performance.now() - lastDragEnd.current < 350) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const forward = spread ? x > rect.width / 2 : x > rect.width * 0.32;
    startTurn(forward ? 'next' : 'prev');
  };

  // Keyboard: opening the cover, and turning pages while a drag is not running.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (phase === 'closed') {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
          event.preventDefault();
          onOpenCover();
        }
        return;
      }
      if (phase !== 'gone' || leafRef.current) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        startTurn('next');
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        startTurn('prev');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenCover, phase, startTurn]);

  useEffect(() => {
    if (covered) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(HINT_KEY) === '1';
    } catch {
      seen = true;
    }
    if (seen) return;
    setHint(true);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    const id = window.setTimeout(() => setHint(false), 7000);
    return () => window.clearTimeout(id);
  }, [covered]);

  // A jump from the pager or tablet of contents wins over any running animation.
  useEffect(() => {
    stopTween(turnRaf);
    setLeaf(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, spread, total]);

  const info = useMemo(() => spreadFor(page, total, spread), [page, total, spread]);
  const base = leaf
    ? { left: leaf.plan.baseLeft, right: leaf.plan.baseRight }
    : { left: info.left, right: info.right };
  const leafEdge = spread ? 'right' : 'single';

  const pageStyle: CSSProperties = { width: pageWidth, height: pageHeight };
  const wrapStyle: CSSProperties = { width: pageWidth * (spread ? 2 : 1), height: pageHeight };
  const stageStyle = { '--cover-shift': `${spread ? pageWidth / 2 : 0}px` } as CSSProperties;
  const coverVisible = phase !== 'gone';

  const frontMatter = (
    <div className="book-frontmatter">
      <span className="book-frontmatter-kicker">Nakhonmaesot Library</span>
      <h3>{title}</h3>
      {author ? <p className="book-frontmatter-author">{author}</p> : null}
      <span className="book-frontmatter-rule" />
      {meta?.publisher || meta?.year ? (
        <p className="book-frontmatter-meta">
          {meta?.publisher ? <span>{meta.publisher}</span> : null}
          {meta?.year ? <span>{meta.year}</span> : null}
        </p>
      ) : null}
      {meta?.category ? <p className="book-frontmatter-meta">{meta.category}</p> : null}
    </div>
  );

  const insideCover = spread ? (
    base.left ? (
      <PageContent page={base.left} render={renderPage} />
    ) : (
      frontMatter
    )
  ) : base.right ? (
    <PageContent page={base.right} render={renderPage} />
  ) : null;

  return (
    <div
      className="book-stage"
      ref={stageRef}
      style={stageStyle}
      data-cover={phase}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onClick={onClick}
    >
      <div className="book-scene">
        <div className="book-wrap" style={wrapStyle}>
          <div className="book-shadow" aria-hidden="true" />
          <div className="book-spread" style={{ width: pageWidth * (spread ? 2 : 1), height: pageHeight }}>
            {spread ? (
              <div className="book-page book-page-left" style={pageStyle}>
                <div className="book-page-body">
                  {base.left ? <PageContent page={base.left} render={renderPage} /> : frontMatter}
                </div>
              </div>
            ) : null}
            <div className={`book-page book-page-right${spread ? '' : ' book-page-single'}`} style={pageStyle}>
              <div className="book-page-body">
                {base.right ? (
                  <PageContent page={base.right} render={renderPage} />
                ) : (
                  <div className="book-endpaper">
                    <span>จบเล่ม</span>
                  </div>
                )}
              </div>
            </div>
            {spread ? <div className="book-gutter" aria-hidden="true" /> : null}
          </div>

          {leaf ? (
            <CurlLeaf
              className="book-turn-leaf"
              shaded
              angle={leaf.angle}
              width={pageWidth}
              height={pageHeight}
              edge={leafEdge}
              front={leaf.plan.front ? <PageContent page={leaf.plan.front} render={renderPage} /> : null}
              back={leaf.plan.back ? <PageContent page={leaf.plan.back} render={renderPage} /> : null}
              style={{
                left: spread ? pageWidth : 0,
                // The whole sheet swings on its spine, so the browser animates one
                // composited transform instead of repainting twenty page slices.
                transform: `translateZ(1px) rotateY(${leaf.angle}deg)`,
              }}
              ariaHidden
            />
          ) : null}

          {coverVisible ? (
            <CurlLeaf
              angle={coverAngle}
              width={pageWidth}
              height={pageHeight}
              edge={leafEdge}
              className={`book-cover-leaf${phase === 'opening' ? ' is-opening' : ''}`}
              frontClass="book-cover-front"
              backClass="book-cover-back"
              style={{
                left: spread ? pageWidth : 0,
                transform: `translateZ(2px) rotateY(${coverAngle}deg)`,
              }}
              ariaLabel="เปิดหนังสือ"
              role="button"
              onClick={(event) => {
                event.stopPropagation();
                if (phase === 'closed') onOpenCover();
              }}
              front={
                <>
                  {coverUrl && !coverBroken ? (
                    <img src={coverUrl} alt={`ปก ${title}`} onError={() => setCoverBroken(true)} draggable={false} />
                  ) : (
                    <div className="book-cover-fallback">
                      <span>Nakhonmaesot Library</span>
                      <strong>{title}</strong>
                    </div>
                  )}
                  <span className="book-cover-spine" aria-hidden="true" />
                  <span className="book-cover-gloss" aria-hidden="true" />
                  {phase === 'closed' ? (
                    <div className="book-cover-cta">
                      <span className="book-cover-kicker">หนังสืออิเล็กทรอนิกส์</span>
                      <button
                        type="button"
                        className="btn btn-primary book-open-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenCover();
                        }}
                      >
                        <Icon name="book" size={17} /> เปิดอ่าน
                      </button>
                      <span className="book-cover-hint">คลิกที่ปก หรือกด Enter</span>
                    </div>
                  ) : null}
                </>
              }
              back={insideCover}
            />
          ) : null}
        </div>
      </div>

      {hint && !covered ? (
        <div className="book-hint" role="status">
          <Icon name="flip" size={15} />
          ลากหน้ากระดาษหรือกดลูกศรเพื่อพลิกหน้า
        </div>
      ) : null}
    </div>
  );
}
