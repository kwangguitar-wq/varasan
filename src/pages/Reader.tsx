import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../lib/api';
import type { Publication, ReaderContent } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { PdfReader } from '../components/PdfReader';
import { BookReader } from '../components/BookReader';
import { EpubPageView, PdfPageView } from '../components/BookPages';
import { loadPdfBytes } from '../lib/pdfSource';
import { paginateChapters } from '../lib/paginate';
import type { EpubPage } from '../lib/paginate';
import { Icon } from '../components/Icons';
import { ProgressBar } from '../components/PublicationCard';
import { fileLabels } from '../lib/format';
import { isPageSoundOn, setPageSoundOn } from '../lib/paperSound';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type Theme = 'light' | 'sepia' | 'dark';
type Mode = 'book' | 'scroll';

/** Safari still ships the prefixed Fullscreen API in some versions. */
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

const STAGE_X = 34;
const STAGE_TOP = 22;
const STAGE_BOTTOM = 94;
const PAGE_RATIO = 0.69;
/** How long the floating toolbar stays up while reading without touching it. */
const BAR_HIDE_MS = 3000;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function Reader() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [content, setContent] = useState<ReaderContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [mode, setMode] = useState<Mode>('book');
  const [zoom, setZoom] = useState(1);
  const [bookZoom, setBookZoom] = useState(1);
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<Theme>('light');
  const [panel, setPanel] = useState<'toc' | 'settings' | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [pageSound, setPageSoundState] = useState(isPageSoundOn);
  const [showCover, setShowCover] = useState(false);
  const [coverReady, setCoverReady] = useState(false);
  const [jumpValue, setJumpValue] = useState('1');
  const [fullscreen, setFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfRatio, setPdfRatio] = useState<number | null>(null);
  const [epubPages, setEpubPages] = useState<EpubPage[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const initialized = useRef(false);
  const completeSent = useRef(false);
  const coverShown = useRef(false);
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();

  useEffect(() => {
    let cancelled = false;
    setPublication(null);
    setContent(null);
    setError(null);
    setPdfDoc(null);
    setEpubPages([]);
    setTotal(0);
    setShowCover(false);
    setCoverReady(false);
    coverShown.current = false;
    initialized.current = false;
    Promise.all([
      api.get<{ publication: Publication }>(`/api/publications/${slug}`),
      api.get<ReaderContent>(`/api/publications/${slug}/content`),
    ])
      .then(([detail, readerContent]) => {
        if (cancelled) return;
        const saved = Math.max(1, detail.publication.progress?.page ?? 1);
        setPublication(detail.publication);
        setContent(readerContent);
        setBookmarked(Boolean(detail.publication.bookmarked));
        setPage(saved);
        setJumpValue(String(saved));
        if (readerContent.kind === 'epub') setChapter(0);
        if (Array.isArray(readerContent.pages)) setTotal(readerContent.pages.length);
        if (!initialized.current) {
          initialized.current = true;
          void api
            .post(`/api/publications/${detail.publication.id}/event`, { type: 'read' })
            .catch(() => null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Load the PDF document once, then keep it for every page of the book.
  useEffect(() => {
    if (content?.kind !== 'pdf' || !content.fileUrl) return;
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    // The book is fetched window by window first: a plain GET would come back
    // as only the first window of a big file and pdf.js would reject it.
    loadPdfBytes(content.fileUrl)
      .then((data) => pdfjs.getDocument({ data }).promise)
      .then(async (document) => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        loaded = document;
        setPdfDoc(document);
        setTotal(document.numPages);
        const first = await document.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (!cancelled) setPdfRatio(viewport.width / viewport.height);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'เปิดไฟล์ PDF ไม่สำเร็จ');
      });
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [content]);

  // Layout of the printed page: everything (PDF pages, ePub pagination) uses it.
  const pageSize = useMemo(() => {
    const availableW = Math.max(0, bodySize.width - STAGE_X * 2);
    const availableH = Math.max(0, bodySize.height - STAGE_TOP - STAGE_BOTTOM) * 0.92;
    if (availableW < 80 || availableH < 80) return null;
    const spread = availableW >= 900;
    const ratio = pdfRatio ?? PAGE_RATIO;
    let height = availableH;
    let width = height * ratio;
    if (width * (spread ? 2 : 1) > availableW) {
      width = availableW / (spread ? 2 : 1);
      height = width / ratio;
    }
    return { pageWidth: Math.floor(width), pageHeight: Math.floor(height), spread };
  }, [bodySize.height, bodySize.width, pdfRatio]);

  const textWidth = pageSize ? Math.round(pageSize.pageWidth * 0.76) : 0;
  const textHeight = pageSize ? Math.round(pageSize.pageHeight * 0.74) : 0;

  // Reflow the ePub into printed pages whenever the page box or font size changes.
  useEffect(() => {
    if (content?.kind !== 'epub' || !content.chapters || !textWidth || !textHeight) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const pages = paginateChapters(content.chapters ?? [], {
        width: textWidth,
        height: textHeight,
        fontSize,
      });
      setEpubPages(pages);
      setTotal(Math.max(1, pages.length));
      setPage((current) => Math.min(Math.max(1, pages.length), Math.max(1, current)));
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) void fonts.ready.then(run).catch(run);
    else run();
    return () => {
      cancelled = true;
    };
  }, [content, fontSize, textHeight, textWidth]);

  // Show the closed cover first — the book always opens like a real book.
  useEffect(() => {
    if (coverShown.current) return;
    if (!publication || !content || !pageSize) return;
    if (content.kind === 'epub' && !epubPages.length) return;
    coverShown.current = true;
    setShowCover(true);
    setCoverReady(true);
  }, [publication, content, pageSize, epubPages.length]);

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  const progressValue = useMemo(() => (total ? Math.min(1, page / total) : 0), [page, total]);

  // Persist reading position (debounced).
  useEffect(() => {
    if (!user || !publication || !total) return;
    const timer = window.setTimeout(() => {
      void api
        .post(`/api/publications/${publication.id}/progress`, {
          progress: Math.min(1, page / total),
          page,
        })
        .catch(() => null);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [page, total, user, publication]);

  useEffect(() => {
    if (!publication || !total || completeSent.current) return;
    if (page >= total && total > 1) {
      completeSent.current = true;
      void api.post(`/api/publications/${publication.id}/event`, { type: 'complete' }).catch(() => null);
    }
  }, [page, total, publication]);

  const previous = useCallback(() => {
    if (content?.kind === 'epub' && mode === 'scroll') {
      setChapter((value) => Math.max(0, value - 1));
      return;
    }
    setPage((value) => Math.max(1, value - 1));
  }, [content?.kind, mode]);

  const next = useCallback(() => {
    if (content?.kind === 'epub' && mode === 'scroll') {
      setChapter((value) => Math.min(Math.max(0, epubPages.length - 1), value + 1));
      return;
    }
    setPage((value) => Math.min(total || 1, value + 1));
  }, [content?.kind, epubPages.length, mode, total]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'Escape') {
        setPanel(null);
        if (immersive) setImmersive(false);
      }
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))));
      if (event.key === '-') setZoom((value) => Math.max(0.6, Number((value - 0.15).toFixed(2))));
      // Book mode owns the arrow keys: it animates a real page turn.
      if (mode !== 'scroll' || showCover) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        next();
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        previous();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [immersive, mode, next, previous, showCover]);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // Fallback for browsers without the Fullscreen API (iOS Safari): track the
  // viewport that is actually visible, and float the toolbar over the page so
  // it can retire and leave the whole screen to the book.
  useEffect(() => {
    const element = wrapperRef.current;
    if (!immersive) {
      setBarHidden(false);
      element?.style.removeProperty('--reader-vh');
      return;
    }

    const viewport = window.visualViewport;
    const applySize = () =>
      element?.style.setProperty('--reader-vh', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
    applySize();
    viewport?.addEventListener('resize', applySize);
    viewport?.addEventListener('scroll', applySize);

    let timer = window.setTimeout(() => setBarHidden(true), BAR_HIDE_MS);
    const reveal = () => {
      setBarHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBarHidden(true), BAR_HIDE_MS);
    };
    element?.addEventListener('pointerdown', reveal);
    element?.addEventListener('focusin', reveal);

    return () => {
      window.clearTimeout(timer);
      viewport?.removeEventListener('resize', applySize);
      viewport?.removeEventListener('scroll', applySize);
      element?.removeEventListener('pointerdown', reveal);
      element?.removeEventListener('focusin', reveal);
    };
  }, [immersive]);

  const toggleFullscreen = async () => {
    const element = wrapperRef.current as FullscreenElement | null;
    const doc = document as FullscreenDocument;

    if (fullscreen || immersive) {
      if (immersive) {
        setImmersive(false);
        return;
      }
      try {
        await (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      } catch {
        // Already out of fullscreen, or the browser refused — reset either way.
      }
      setFullscreen(false);
      return;
    }

    const request = element && (element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element));
    if (request) {
      try {
        await request();
        setFullscreen(true);
        return;
      } catch {
        // iOS Safari exposes the method for <video> only — fall through.
      }
    }
    setImmersive(true);
  };

  const toggleBookmark = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/read/${slug}` } });
      return;
    }
    if (!publication) return;
    try {
      const data = await api.post<{ bookmarked: boolean }>(`/api/publications/${publication.id}/bookmark`);
      setBookmarked(data.bookmarked);
      toast.show(data.bookmarked ? 'บันทึกไว้ในชั้นหนังสือ' : 'นำออกจากชั้นหนังสือแล้ว', 'success');
    } catch (err) {
      toast.show((err as Error).message, 'error');
    }
  };

  const download = () => {
    if (!publication) return;
    const anchor = document.createElement('a');
    anchor.href = `/api/publications/${publication.id}/download`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const jumpTo = (value: number) => {
    const target = Math.min(total || 1, Math.max(1, value));
    if (content?.kind === 'epub' && mode === 'scroll') {
      const match = epubPages.findIndex((item) => item.number === target);
      setChapter(match >= 0 ? epubPages[match].chapterIndex : 0);
      return;
    }
    setPage(target);
  };

  const renderPage = useCallback(
    (target: number) => {
      if (content?.kind === 'pdf') {
        if (!pdfDoc || target < 1 || target > pdfDoc.numPages) return null;
        return <PdfPageView doc={pdfDoc} page={target} width={(pageSize?.pageWidth ?? 640) * 1.6} />;
      }
      if (content?.kind === 'epub') {
        const item = epubPages[target - 1];
        if (!item) return null;
        return <EpubPageView page={item} fontSize={fontSize} textWidth={textWidth} textHeight={textHeight} />;
      }
      const pages = Array.isArray(content?.pages) ? content.pages : [];
      const src = pages[target - 1];
      if (!src) return null;
      return <img className="book-image-page" src={src} alt={`หน้า ${target}`} draggable={false} />;
    },
    [content, epubPages, fontSize, pdfDoc, pageSize?.pageWidth, textHeight, textWidth],
  );

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (mode !== 'scroll') return;
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) next();
      else previous();
    }
    touchStart.current = null;
  };

  if (error) {
    return (
      <div className="reader-error-screen">
        <Icon name="warning" size={32} />
        <h2>เปิดเอกสารไม่สำเร็จ</h2>
        <p>{error}</p>
        <Link to="/library" className="btn btn-primary">
          กลับไปที่คลังสารสนเทศ
        </Link>
      </div>
    );
  }

  const kind = content?.kind;
  const canBook = kind === 'pdf' || kind === 'epub' || kind === 'flipbook';
  const bookMode = mode === 'book' && canBook;
  const ready =
    publication &&
    content &&
    pageSize &&
    coverReady &&
    (kind === 'pdf' ? Boolean(pdfDoc) : kind === 'epub' ? epubPages.length > 0 : true);
  const currentChapter = kind === 'epub' ? epubPages[page - 1]?.chapterIndex ?? 0 : 0;

  const pagerLabel = (() => {
    if (!total) return '';
    if (kind === 'epub' && mode === 'scroll') return `บทที่ ${chapter + 1} / ${epubPages.length || 1}`;
    if (bookMode && pageSize?.spread && page > 1 && page + 1 <= total) return `หน้า ${page}–${page + 1} / ${total}`;
    return `หน้า ${page} / ${total}`;
  })();

  return (
    <div
      className={`reader reader-theme-${theme}${immersive ? ' reader-immersive' : ''}${
        immersive && barHidden ? ' reader-bar-hidden' : ''
      }`}
      ref={wrapperRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <header className="reader-topbar">
        <div className="reader-topbar-left">
          <button type="button" className="reader-icon" onClick={() => navigate(`/item/${slug}`)} aria-label="ปิดหน้าอ่าน">
            <Icon name="arrowLeft" size={20} />
          </button>
          <div className="reader-title">
            <strong>{publication?.title ?? 'กำลังโหลด…'}</strong>
            <span>
              {publication ? `${fileLabels[publication.fileType ?? 'pdf']} · ${publication.author ?? ''}` : ''}
            </span>
          </div>
        </div>
        <div className="reader-topbar-center">
          <span className="reader-pager">{pagerLabel}</span>
        </div>
        <div className="reader-topbar-right">
          <button
            type="button"
            className="reader-icon"
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
            aria-label="สารบัญ"
            title="สารบัญ"
          >
            <Icon name="list" size={19} />
          </button>
          <button
            type="button"
            className={`reader-icon ${bookmarked ? 'active' : ''}`}
            onClick={toggleBookmark}
            aria-label="บันทึกไว้"
            title="บันทึกไว้"
          >
            <Icon name="bookmark" size={19} filled={bookmarked} />
          </button>
          <button type="button" className="reader-icon" onClick={download} aria-label="ดาวน์โหลด" title="ดาวน์โหลด">
            <Icon name="download" size={19} />
          </button>
          <button
            type="button"
            className={`reader-icon${pageSound ? '' : ' is-muted'}`}
            onClick={() => {
              const next = !pageSound;
              setPageSoundOn(next);
              setPageSoundState(next);
            }}
            aria-label={pageSound ? 'ปิดเสียงพลิกหน้า' : 'เปิดเสียงพลิกหน้า'}
            aria-pressed={pageSound}
            title={pageSound ? 'ปิดเสียงพลิกหน้า' : 'เปิดเสียงพลิกหน้า'}
          >
            <Icon name={pageSound ? 'volume' : 'volumeOff'} size={19} />
          </button>
          <button
            type="button"
            className="reader-icon"
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            aria-label="ตั้งค่าการอ่าน"
            title="ตั้งค่าการอ่าน"
          >
            <Icon name="text" size={19} />
          </button>
          <button
            type="button"
            className="reader-icon reader-fullscreen"
            onClick={toggleFullscreen}
            aria-label={fullscreen || immersive ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
            title={fullscreen || immersive ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
            aria-pressed={fullscreen || immersive}
          >
            <Icon name="external" size={19} />
          </button>
        </div>
        <div className="reader-progress-line">
          <span style={{ width: `${Math.round(progressValue * 100)}%` }} />
        </div>
      </header>

      <div className={`reader-body${bookMode ? ' reader-body-book' : ''}`} ref={bodyRef}>
        {!ready ? (
          <div className="reader-loading">
            <span className="spinner" />
            <p>กำลังเปิดหนังสือ…</p>
          </div>
        ) : bookMode && pageSize ? (
          <>
          <BookReader
            title={publication!.title}
            author={publication!.author}
            coverUrl={publication!.coverUrl}
            meta={{ publisher: publication!.publisher, year: publication!.year, category: publication!.category?.name ?? null }}
            total={total}
            page={page}
            pageWidth={pageSize.pageWidth}
            pageHeight={pageSize.pageHeight}
            spread={pageSize.spread}
            renderPage={renderPage}
            showCover={showCover}
            onOpenCover={() => setShowCover(false)}
            onPage={setPage}
            zoom={bookZoom}
          />
          {/* Rasterising a page takes long enough to stall the first frames of a
              turn, so the pages just ahead are drawn while the reader idles. */}
          {kind === 'pdf' && pdfDoc ? (
            <div className="book-preload" aria-hidden="true">
              {[page + 1, page + 2, page + 3, page + 4].map((target) =>
                target <= total ? (
                  <PdfPageView
                    key={target}
                    doc={pdfDoc}
                    page={target}
                    width={pageSize.pageWidth * 1.6}
                  />
                ) : null,
              )}
            </div>
          ) : null}
          </>
        ) : kind === 'pdf' && content?.fileUrl ? (
          <PdfReader
            url={content.fileUrl}
            page={page}
            zoom={zoom}
            onPage={setPage}
            onTotal={setTotal}
          />
        ) : kind === 'epub' ? (
          <div className="epub-scroll">
            <article
              className="epub-content"
              style={{ fontSize: `${fontSize}px` }}
              dangerouslySetInnerHTML={{ __html: content?.chapters?.[chapter]?.html ?? '<p>ไม่พบเนื้อหา</p>' }}
            />
            <div className="epub-nav">
              <button type="button" className="btn btn-outline" onClick={previous} disabled={chapter === 0}>
                <Icon name="chevronLeft" size={16} /> บทก่อนหน้า
              </button>
              <span>
                {chapter + 1} / {content?.chapters?.length ?? 1}
              </span>
              <button
                type="button"
                className="btn btn-outline"
                onClick={next}
                disabled={chapter >= (content?.chapters?.length ?? 1) - 1}
              >
                บทถัดไป <Icon name="chevronRight" size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="reader-error">
            <Icon name="file" size={28} />
            <h3>ไม่พบเนื้อหาที่อ่านได้</h3>
            <button type="button" className="btn btn-primary" onClick={download}>
              ดาวน์โหลดไฟล์
            </button>
          </div>
        )}
      </div>

      {!(kind === 'epub' && mode === 'scroll') ? (
        <div className="reader-bottom">
          <button type="button" className="reader-nav-button" onClick={previous} disabled={page <= 1} aria-label="หน้าก่อนหน้า">
            <Icon name="chevronLeft" size={20} />
          </button>
          <div className="reader-jump">
            <input
              value={jumpValue}
              inputMode="numeric"
              onChange={(event) => setJumpValue(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => jumpTo(Number(jumpValue) || 1)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpTo(Number(jumpValue) || 1);
              }}
              aria-label="กระโดดไปยังหน้า"
            />
            <span>/ {total}</span>
          </div>
          <button type="button" className="reader-nav-button" onClick={next} disabled={page >= total} aria-label="หน้าถัดไป">
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      ) : null}

      {panel ? <div className="reader-backdrop" onClick={() => setPanel(null)} /> : null}

      <aside className={`reader-panel reader-panel-left ${panel === 'toc' ? 'open' : ''}`} aria-hidden={panel !== 'toc'}>
        <div className="reader-panel-head">
          <h3>สารบัญ</h3>
          <button type="button" className="reader-icon" onClick={() => setPanel(null)} aria-label="ปิด">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="reader-panel-body">
          {kind === 'epub' ? (
            <div className="toc-list">
              {(content?.chapters ?? []).map((item, index) => {
                const firstPage = epubPages.findIndex((entry) => entry.chapterIndex === index);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`toc-item ${index === currentChapter ? 'active' : ''}`}
                    onClick={() => {
                      if (firstPage >= 0) {
                        setPage(firstPage + 1);
                        setChapter(index);
                      }
                      setPanel(null);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {item.title}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="thumb-grid">
              {Array.from({ length: total }).map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`thumb-item ${page === index + 1 || page === index + 2 ? 'active' : ''}`}
                  onClick={() => {
                    jumpTo(index + 1);
                    setPanel(null);
                  }}
                >
                  <span>{index + 1}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <aside className={`reader-panel reader-panel-right ${panel === 'settings' ? 'open' : ''}`} aria-hidden={panel !== 'settings'}>
        <div className="reader-panel-head">
          <h3>ตั้งค่าการอ่าน</h3>
          <button type="button" className="reader-icon" onClick={() => setPanel(null)} aria-label="ปิด">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="reader-panel-body">
          <div className="reader-setting">
            <h4>ธีม</h4>
            <div className="theme-options">
              {(
                [
                  { value: 'light', label: 'สว่าง', color: '#ffffff' },
                  { value: 'sepia', label: 'กระดาษ', color: '#f3e9d6' },
                  { value: 'dark', label: 'มืด', color: '#10151c' },
                ] as const
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={theme === item.value ? 'active' : ''}
                  onClick={() => setTheme(item.value)}
                >
                  <span style={{ background: item.color }} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {canBook ? (
            <div className="reader-setting">
              <h4>โหมดการอ่าน</h4>
              <div className="segmented">
                <button
                  type="button"
                  className={mode === 'book' ? 'active' : ''}
                  onClick={() => setMode('book')}
                  title="เปิดแบบหนังสือ พลิกหน้าทีละแผ่น"
                >
                  <Icon name="book" size={15} /> หนังสือ
                </button>
                <button
                  type="button"
                  className={mode === 'scroll' ? 'active' : ''}
                  onClick={() => {
                    setMode('scroll');
                    setShowCover(false);
                  }}
                  title="เลื่อนเนื้อหาต่อเนื่อง"
                >
                  <Icon name="list" size={15} /> เลื่อนต่อเนื่อง
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'book' && canBook ? (
            <div className="reader-setting">
              <h4>ปกหนังสือ</h4>
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={() => {
                  setPanel(null);
                  setShowCover(true);
                }}
              >
                <Icon name="book" size={16} /> เปิดดูปกแล้วเปิดเล่มใหม่
              </button>
            </div>
          ) : null}

          {mode === 'book' && canBook ? (
            <div className="reader-setting">
              <h4>ขยายหน้าหนังสือ</h4>
              <div className="stepper">
                <button type="button" onClick={() => setBookZoom((value) => Math.max(1, Number((value - 0.1).toFixed(1))))} aria-label="ย่อหนังสือ">−</button>
                <span>{Math.round(bookZoom * 100)}%</span>
                <button type="button" onClick={() => setBookZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(1))))} aria-label="ขยายหนังสือ">+</button>
              </div>
              <p className="reader-progress-text">ปรับขนาดหนังสือเพื่ออ่านข้อความได้ชัดขึ้น</p>
            </div>
          ) : null}

          {kind === 'pdf' && mode === 'scroll' ? (
            <div className="reader-setting">
              <h4>ขนาดหน้า</h4>
              <div className="stepper">
                <button type="button" onClick={() => setZoom((value) => Math.max(0.6, Number((value - 0.15).toFixed(2))))} aria-label="ย่อ">
                  <Icon name="zoomOut" size={17} />
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))))} aria-label="ขยาย">
                  <Icon name="zoomIn" size={17} />
                </button>
              </div>
            </div>
          ) : null}

          {kind === 'epub' ? (
            <div className="reader-setting">
              <h4>ขนาดตัวอักษร</h4>
              <div className="stepper">
                <button type="button" onClick={() => setFontSize((value) => Math.max(15, value - 1))} aria-label="ลดขนาด">
                  A-
                </button>
                <span>{fontSize}px</span>
                <button type="button" onClick={() => setFontSize((value) => Math.min(26, value + 1))} aria-label="เพิ่มขนาด">
                  A+
                </button>
              </div>
            </div>
          ) : null}

          <div className="reader-setting">
            <h4>ความคืบหน้า</h4>
            <ProgressBar value={progressValue} />
            <p className="reader-progress-text">อ่านแล้ว {Math.round(progressValue * 100)}% · บันทึกอัตโนมัติ</p>
          </div>

          <div className="reader-setting reader-shortcuts">
            <h4>ทางลัด</h4>
            <ul>
              <li>
                <kbd>←</kbd> <kbd>→</kbd> พลิกหน้า
              </li>
              <li>ลากหน้ากระดาษเพื่อพลิก หรือคลิกครึ่งซ้าย/ขวา</li>
              <li>
                <kbd>+</kbd> <kbd>−</kbd> ปรับขนาด
              </li>
              <li>
                <kbd>Esc</kbd> ปิดแผง
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
