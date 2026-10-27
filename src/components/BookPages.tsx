import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EpubPage } from '../lib/paginate';

const MAX_CACHED_PAGES = 28;
const pageCache = new Map<string, string>();

function cacheKey(doc: PDFDocumentProxy, page: number, width: number) {
  const fingerprint = doc.fingerprints?.[0] ?? 'pdf';
  return `${fingerprint}:${page}:${width}`;
}

function remember(key: string, value: string) {
  if (pageCache.size >= MAX_CACHED_PAGES) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) pageCache.delete(oldest);
  }
  pageCache.set(key, value);
}

/** Renders one PDF page as an image that fills its book page. */
export function PdfPageView({ doc, page, width }: { doc: PDFDocumentProxy; page: number; width: number }) {
  const targetWidth = Math.max(320, Math.min(1800, Math.round(width)));
  const key = cacheKey(doc, page, targetWidth);
  const [src, setSrc] = useState<string | null>(() => pageCache.get(key) ?? null);

  useEffect(() => {
    const cached = pageCache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    setSrc(null);
    (async () => {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({ scale: (targetWidth * dpr) / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      remember(key, dataUrl);
      if (!cancelled) setSrc(dataUrl);
    })().catch(() => {
      if (!cancelled) setSrc(null);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, key, targetWidth]);

  if (!src) return <div className="book-page-skeleton" aria-hidden="true" />;
  return <img className="book-pdf-page" src={src} alt={`หน้า ${page}`} draggable={false} />;
}

/** Renders one paginated ePub page with a running head and page folio. */
export function EpubPageView({
  page,
  fontSize,
  textWidth,
  textHeight,
}: {
  page: EpubPage;
  fontSize: number;
  textWidth: number;
  textHeight: number;
}) {
  return (
    <div className="book-text-page">
      <span className="book-running-head">{page.chapterTitle}</span>
      <div className="book-text" style={{ width: textWidth, height: textHeight, fontSize: `${fontSize}px` }}>
        <div className="book-text-page-content" dangerouslySetInnerHTML={{ __html: page.html }} />
      </div>
      <span className="book-folio">{page.number}</span>
    </div>
  );
}
