export interface EpubSourceChapter {
  id: string;
  title: string;
  html: string;
}

export interface EpubPage {
  number: number;
  chapterIndex: number;
  chapterTitle: string;
  html: string;
}

interface PaginateOptions {
  width: number;
  height: number;
  fontSize: number;
}

/**
 * Splits ePub chapters into fixed-size pages that match a printed book page.
 * Measurement uses the very same `.book-text-page-content` markup and typography
 * that the reader renders, so page breaks land where the reader sees them.
 */
export function paginateChapters(chapters: EpubSourceChapter[], options: PaginateOptions): EpubPage[] {
  const width = Math.floor(options.width);
  const height = Math.floor(options.height);
  if (!chapters.length || width < 120 || height < 120 || typeof document === 'undefined') return [];

  const host = document.createElement('div');
  host.className = 'book-text book-text-measure';
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.fontSize = `${options.fontSize}px`;
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  const pages: EpubPage[] = [];
  const push = (chapterIndex: number, chapterTitle: string, html: string) => {
    if (!html.trim()) return;
    pages.push({ number: pages.length + 1, chapterIndex, chapterTitle, html });
  };

  try {
    chapters.forEach((chapter, chapterIndex) => {
      const source = document.createElement('div');
      source.innerHTML = chapter.html ?? '';
      const blocks: HTMLElement[] = [];
      for (const node of Array.from(source.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          blocks.push(node as HTMLElement);
        } else if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()) {
          const paragraph = document.createElement('p');
          paragraph.textContent = node.textContent;
          blocks.push(paragraph);
        }
      }
      if (!blocks.length) return;

      const sheet = document.createElement('div');
      sheet.className = 'book-text-page-content';
      host.appendChild(sheet);

      for (const block of blocks) {
        sheet.appendChild(block);
        if (sheet.scrollHeight > height && sheet.childNodes.length > 1) {
          sheet.removeChild(block);
          push(chapterIndex, chapter.title, sheet.innerHTML);
          sheet.innerHTML = '';
          sheet.appendChild(block);
        }
      }
      push(chapterIndex, chapter.title, sheet.innerHTML);
      host.removeChild(sheet);
    });
  } finally {
    host.remove();
  }

  return pages;
}
