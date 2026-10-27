import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon } from './Icons';
import type { PublicationType, Tag } from '../lib/types';

interface SuggestPublication {
  id: number;
  slug: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  type: PublicationType;
}

interface SuggestResponse {
  publications: SuggestPublication[];
  keywords: { term: string; count: number }[];
  tags: Tag[];
}

interface SearchBarProps {
  initialValue?: string;
  variant?: 'header' | 'hero' | 'page';
  autoFocus?: boolean;
  onSearch?: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({
  initialValue = '',
  variant = 'header',
  autoFocus = false,
  onSearch,
  placeholder = 'ค้นหาชื่อเรื่อง ผู้แต่ง คำสำคัญ หรือ ISBN…',
}: SearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) {
      setSuggest(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get<SuggestResponse>(`/api/search/suggest?q=${encodeURIComponent(term)}`);
        if (!controller.signal.aborted) setSuggest(data);
      } catch {
        /* ignore suggestions errors */
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const submit = (term: string) => {
    const query = term.trim();
    setOpen(false);
    setActiveIndex(-1);
    if (onSearch) onSearch(query);
    else navigate(`/library${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  };

  const flattened = [
    ...(suggest?.publications ?? []).map((item) => ({ kind: 'publication' as const, item })),
    ...(suggest?.keywords ?? []).map((item) => ({ kind: 'keyword' as const, item })),
    ...(suggest?.tags ?? []).map((item) => ({ kind: 'tag' as const, item })),
  ].slice(0, 7);

  return (
    <div className={`searchbar searchbar-${variant}`} ref={containerRef}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const chosen = activeIndex >= 0 ? flattened[activeIndex] : null;
          if (chosen?.kind === 'publication') {
            setOpen(false);
            navigate(`/item/${chosen.item.slug}`);
            return;
          }
          if (chosen?.kind === 'keyword') {
            submit(chosen.item.term);
            return;
          }
          if (chosen?.kind === 'tag') {
            submit(chosen.item.name);
            return;
          }
          submit(value);
        }}
      >
        <Icon name="search" size={variant === 'hero' ? 22 : 18} className="searchbar-icon" />
        <input
          type="search"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label="ค้นหาสารสนเทศ"
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(flattened.length - 1, index + 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(-1, index - 1));
            }
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        <button type="submit" className="searchbar-submit" aria-label="ค้นหา">
          {variant === 'hero' ? 'ค้นหา' : <Icon name="arrowRight" size={17} />}
        </button>
      </form>

      {open && value.trim().length >= 2 ? (
        <div className="search-suggest">
          {suggest?.publications.length ? (
            <div className="suggest-group">
              <span className="suggest-label">รายการที่เกี่ยวข้อง</span>
              {suggest.publications.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="suggest-item"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/item/${item.slug}`);
                  }}
                >
                  <span className="suggest-cover">
                    {item.cover_url ? <img src={item.cover_url} alt="" /> : <Icon name="file" size={16} />}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.author ?? 'ไม่ระบุผู้แต่ง'}</small>
                  </span>
                  <Icon name="chevronRight" size={15} />
                </button>
              ))}
            </div>
          ) : null}
          {suggest?.keywords.length ? (
            <div className="suggest-group">
              <span className="suggest-label">คำสำคัญในเนื้อหา</span>
              <div className="suggest-chips">
                {suggest.keywords.slice(0, 5).map((keyword) => (
                  <button
                    key={keyword.term}
                    type="button"
                    className="chip chip-ghost"
                    onClick={() => {
                      setValue(keyword.term);
                      submit(keyword.term);
                    }}
                  >
                    <Icon name="sparkle" size={13} /> {keyword.term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {suggest?.tags.length ? (
            <div className="suggest-group">
              <span className="suggest-label">แท็ก</span>
              <div className="suggest-chips">
                {suggest.tags.slice(0, 4).map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="chip chip-ghost"
                    onClick={() => submit(tag.name)}
                  >
                    <Icon name="tag" size={13} /> {tag.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!flattened.length ? <p className="suggest-empty">ไม่พบคำแนะนำ — กด Enter เพื่อค้นหาทั้งคลัง</p> : null}
        </div>
      ) : null}
    </div>
  );
}
