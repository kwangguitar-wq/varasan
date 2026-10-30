import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Icon } from './Icons';
import { loadPdfBytes } from '../lib/pdfSource';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfReaderProps {
  url: string;
  page: number;
  zoom: number;
  onPage: (page: number) => void;
  onTotal: (total: number) => void;
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function PdfPageImage({
  doc,
  pageNumber,
  width,
  zoom,
  onVisible,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  zoom: number;
  onVisible: (page: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [visible, setVisible] = useState(false);
  const renderedRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    doc
      .getPage(pageNumber)
      .then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        if (!cancelled) setRatio(viewport.height / viewport.width);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (entry.intersectionRatio > 0.45) onVisible(pageNumber);
          }
        }
      },
      { rootMargin: '600px 0px', threshold: [0.05, 0.5] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!visible || !width) return;
    const key = `${pageNumber}:${Math.round(width)}:${zoom}`;
    if (renderedRef.current === key) return;
    renderedRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const targetWidth = width * zoom;
        const scale = (targetWidth * dpr) / viewport.width;
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(scaled.width);
        canvas.height = Math.floor(scaled.height);
        const context = canvas.getContext('2d');
        if (!context) return;
        await page.render({ canvasContext: context, viewport: scaled, canvas }).promise;
        if (!cancelled) setSrc(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        /* keep skeleton if rendering fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, width, zoom, doc, pageNumber]);

  return (
    <div
      ref={containerRef}
      id={`pdf-page-${pageNumber}`}
      className="pdf-page"
      style={{ width: Math.max(220, Math.round(Math.min(width || 720, 880) * zoom)), aspectRatio: `1 / ${ratio}` }}
    >
      {src ? <img src={src} alt={`หน้า ${pageNumber}`} loading="lazy" /> : <div className="page-skeleton" />}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

export function PdfReader({ url, page, zoom, onPage, onTotal }: PdfReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastObserved = useRef(0);
  const scrollReady = useRef(false);
  const scrollWidth = useContainerWidth(scrollRef);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    // Fetched as explicit windows: a plain GET returns only the first window of
    // a big book and pdf.js then misses the trailer (see loadPdfBytes).
    loadPdfBytes(url)
      .then((data) => pdfjs.getDocument({ data }).promise)
      .then((document) => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        loaded = document;
        setDoc(document);
        onTotal(document.numPages);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'ไม่สามารถเปิดไฟล์ PDF ได้');
      });
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [url, onTotal]);

  // Restore the saved page on first paint before switching to scroll tracking.
  useEffect(() => {
    if (!doc || !scrollWidth) return;
    scrollReady.current = false;
    const timer = window.setTimeout(() => {
      document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ block: 'start' });
      scrollReady.current = true;
    }, 60);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, scrollWidth]);

  // Follow explicit page changes (pager, TOC) in continuous scroll mode.
  useEffect(() => {
    if (!scrollReady.current) return;
    if (page === lastObserved.current) return;
    document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);

  const handleVisible = useCallback(
    (visiblePage: number) => {
      if (!scrollReady.current) return;
      lastObserved.current = visiblePage;
      onPage(visiblePage);
    },
    [onPage],
  );

  if (error) {
    return (
      <div className="reader-error">
        <Icon name="warning" size={28} />
        <h3>เปิดไฟล์ PDF ไม่สำเร็จ</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="pdf-scroll" ref={scrollRef}>
      {!doc ? (
        <div className="reader-loading">
          <span className="spinner" />
          <p>กำลังโหลดเอกสาร…</p>
        </div>
      ) : (
        <div className="pdf-pages">
          {Array.from({ length: doc.numPages }).map((_, index) => (
            <PdfPageImage
              key={index + 1}
              doc={doc}
              pageNumber={index + 1}
              width={scrollWidth}
              zoom={zoom}
              onVisible={handleVisible}
            />
          ))}
        </div>
      )}
    </div>
  );
}
