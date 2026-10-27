import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryString } from '../lib/api';
import type { Category, Facets, Publication, SearchResult } from '../lib/types';
import { SearchBar } from '../components/SearchBar';
import { PublicationCard } from '../components/PublicationCard';
import { Icon } from '../components/Icons';
import { biblioYear, formatNumber, typeLabels } from '../lib/format';

const SORTS = [
  { value: 'newest', label: 'มาใหม่ล่าสุด' },
  { value: 'popular', label: 'ยอดนิยม' },
  { value: 'year', label: 'ปีที่พิมพ์ (ใหม่→เก่า)' },
  { value: 'title', label: 'ชื่อเรื่อง ก–ฮ' },
  { value: 'oldest', label: 'ปีที่พิมพ์ (เก่า→ใหม่)' },
];

const TYPES = [
  { value: '', label: 'ทุกประเภท' },
  { value: 'journal', label: 'วารสาร' },
  { value: 'ebook', label: 'หนังสือ' },
  { value: 'research', label: 'งานวิจัย' },
  { value: 'flipbook', label: 'Flipbook' },
  { value: 'report', label: 'รายงาน' },
  { value: 'magazine', label: 'นิตยสาร' },
];

const LANGUAGES = [
  { value: '', label: 'ทุกภาษา' },
  { value: 'th', label: 'ไทย' },
  { value: 'en', label: 'อังกฤษ' },
];

export function Library() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState({ author: '', publisher: '', issn: '', isbn: '', yearFrom: '', yearTo: '' });

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const type = params.get('type') ?? '';
  const tag = params.get('tag') ?? '';
  const year = params.get('year') ?? '';
  const language = params.get('language') ?? '';
  const sort = params.get('sort') ?? (q ? 'relevance' : 'newest');
  const page = Number(params.get('page') ?? '1');

  const activeFilterCount = [category, type, tag, year, language, params.get('author'), params.get('publisher'), params.get('issn'), params.get('isbn'), params.get('yearFrom'), params.get('yearTo')].filter(Boolean).length;

  useEffect(() => {
    api
      .get<{ categories: Category[] }>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => null);
    api.get<Facets>('/api/search/facets').then(setFacets).catch(() => null);
  }, []);

  useEffect(() => {
    setAdvanced({
      author: params.get('author') ?? '',
      publisher: params.get('publisher') ?? '',
      issn: params.get('issn') ?? '',
      isbn: params.get('isbn') ?? '',
      yearFrom: params.get('yearFrom') ?? '',
      yearTo: params.get('yearTo') ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const requestQuery = useMemo(
    () =>
      queryString({
        q,
        category,
        type,
        tag,
        year,
        language,
        sort: sort === 'relevance' ? undefined : sort,
        page,
        limit: 12,
        author: params.get('author'),
        publisher: params.get('publisher'),
        issn: params.get('issn'),
        isbn: params.get('isbn'),
        yearFrom: params.get('yearFrom'),
        yearTo: params.get('yearTo'),
      }),
    [q, category, type, tag, year, language, sort, page, params],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<SearchResult>(`/api/publications${requestQuery}`)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestQuery]);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    next.delete('focus');
    setParams(next, { replace: true });
  };

  const submitAdvanced = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(advanced)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    setParams(next, { replace: true });
    setAdvancedOpen(false);
    setFiltersOpen(false);
  };

  const clearAll = () => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    setParams(next, { replace: true });
    setAdvanced({ author: '', publisher: '', issn: '', isbn: '', yearFrom: '', yearTo: '' });
  };

  const activeChips: { key: string; label: string; value: string }[] = [];
  if (q) activeChips.push({ key: 'q', label: `ค้นหา: ${q}`, value: q });
  if (type) activeChips.push({ key: 'type', label: typeLabels[type as Publication['type']] ?? type, value: type });
  if (category) {
    const found = categories.find((item) => item.slug === category);
    activeChips.push({ key: 'category', label: found?.name ?? category, value: category });
  }
  if (tag) activeChips.push({ key: 'tag', label: `แท็ก: ${tag}`, value: tag });
  if (year) activeChips.push({ key: 'year', label: biblioYear(Number(year)), value: year });
  if (language) activeChips.push({ key: 'language', label: language === 'th' ? 'ภาษาไทย' : 'ภาษาอังกฤษ', value: language });
  for (const key of ['author', 'publisher', 'issn', 'isbn', 'yearFrom', 'yearTo']) {
    const value = params.get(key);
    if (!value) continue;
    const labels: Record<string, string> = {
      author: 'ผู้แต่ง',
      publisher: 'สำนักพิมพ์',
      issn: 'ISSN',
      isbn: 'ISBN',
      yearFrom: 'ปีเริ่ม',
      yearTo: 'ปีสิ้นสุด',
    };
    activeChips.push({ key, label: `${labels[key]}: ${value}`, value });
  }

  const pages = result?.pages ?? 1;

  const filterPanel = (
    <div className="filter-panel">
      <div className="filter-head">
        <h2>
          <Icon name="sliders" size={18} /> ตัวกรอง
        </h2>
        <div className="filter-head-actions">
          {activeFilterCount ? (
            <button type="button" className="link-button" onClick={clearAll}>
              ล้างทั้งหมด
            </button>
          ) : null}
          <button type="button" className="icon-button mobile-only" onClick={() => setFiltersOpen(false)} aria-label="ปิดตัวกรอง">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      <div className="filter-group">
        <h3>ประเภท</h3>
        <div className="filter-chips">
          {TYPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${type === item.value ? 'chip-active' : ''}`}
              onClick={() => update('type', item.value || null)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <h3>หมวดหมู่</h3>
        <div className="filter-list">
          <button type="button" className={`filter-row ${!category ? 'active' : ''}`} onClick={() => update('category', null)}>
            <span>ทุกหมวดหมู่</span>
            <em>{result?.total ?? '—'}</em>
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-row ${category === item.slug ? 'active' : ''}`}
              onClick={() => update('category', item.slug)}
            >
              <span>
                <i className="category-dot" style={{ background: item.accent }} /> {item.name}
              </span>
              <em>{item.count ?? 0}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group filter-row-2">
        <div>
          <h3>ปีที่พิมพ์</h3>
          <select className="input" value={year} onChange={(event) => update('year', event.target.value)}>
            <option value="">ทุกปี</option>
            {(facets?.years ?? []).map((item) => (
              <option key={item.year} value={item.year}>
                พ.ศ. {item.year} ({item.count})
              </option>
            ))}
          </select>
        </div>
        <div>
          <h3>ภาษา</h3>
          <select className="input" value={language} onChange={(event) => update('language', event.target.value)}>
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-group">
        <h3>แท็กยอดนิยม</h3>
        <div className="filter-chips">
          {(facets?.tags ?? []).slice(0, 12).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip ${tag === item.name ? 'chip-active' : ''}`}
              onClick={() => update('tag', tag === item.name ? null : item.name)}
            >
              <Icon name="tag" size={12} /> {item.name}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((open) => !open)}>
          <span>
            <Icon name="search" size={16} /> ค้นหาขั้นสูง
          </span>
          <Icon name={advancedOpen ? 'chevronDown' : 'chevronRight'} size={16} />
        </button>
        {advancedOpen ? (
          <form className="advanced-form" onSubmit={submitAdvanced}>
            <label>
              ผู้แต่ง
              <input
                className="input"
                value={advanced.author}
                onChange={(event) => setAdvanced({ ...advanced, author: event.target.value })}
                placeholder="เช่น ณัฐฐิญา"
              />
            </label>
            <label>
              สำนักพิมพ์
              <input
                className="input"
                value={advanced.publisher}
                onChange={(event) => setAdvanced({ ...advanced, publisher: event.target.value })}
                placeholder="ชื่อสำนักพิมพ์"
              />
            </label>
            <div className="filter-row-2">
              <label>
                ISSN
                <input
                  className="input"
                  value={advanced.issn}
                  onChange={(event) => setAdvanced({ ...advanced, issn: event.target.value })}
                  placeholder="2586-8414"
                />
              </label>
              <label>
                ISBN
                <input
                  className="input"
                  value={advanced.isbn}
                  onChange={(event) => setAdvanced({ ...advanced, isbn: event.target.value })}
                  placeholder="978-616"
                />
              </label>
            </div>
            <div className="filter-row-2">
              <label>
                ปีเริ่มต้น
                <input
                  className="input"
                  inputMode="numeric"
                  value={advanced.yearFrom}
                  onChange={(event) => setAdvanced({ ...advanced, yearFrom: event.target.value })}
                  placeholder="2560"
                />
              </label>
              <label>
                ปีสิ้นสุด
                <input
                  className="input"
                  inputMode="numeric"
                  value={advanced.yearTo}
                  onChange={(event) => setAdvanced({ ...advanced, yearTo: event.target.value })}
                  placeholder="2568"
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary btn-block">
              ใช้เงื่อนไขนี้
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <section className="page-hero page-hero-library">
        <div className="section-inner">
          <nav className="breadcrumb">
            <Link to="/">หน้าแรก</Link>
            <Icon name="chevronRight" size={13} />
            <span>คลังสารสนเทศ</span>
          </nav>
          <div className="library-heading">
            <div>
              <span className="eyebrow">Catalog</span>
              <h1>ค้นพบสารสนเทศที่ใช่</h1>
              <p>
                {result ? `พบ ${formatNumber(result.total)} รายการ` : 'กำลังโหลดรายการ'} จากวารสาร งานวิจัย
                และหนังสืออิเล็กทรอนิกส์ในคลัง
              </p>
            </div>
            <div className="library-heading-badges">
              <span className="chip chip-soft">
                <Icon name="book" size={14} /> PDF · ePub · Flipbook
              </span>
              <span className="chip chip-soft">
                <Icon name="search" size={14} /> ดัชนีคำสำคัญภาษาไทย
              </span>
            </div>
          </div>
          <div className="library-search">
            <SearchBar variant="page" initialValue={q} autoFocus={params.get('focus') === 'search'} />
          </div>
        </div>
      </section>

      <section className="section section-library">
        <div className="section-inner library-layout">
          <aside className={`library-sidebar ${filtersOpen ? 'open' : ''}`}>{filterPanel}</aside>
          {filtersOpen ? <div className="drawer-backdrop" onClick={() => setFiltersOpen(false)} /> : null}

          <div className="library-main">
            <div className="toolbar">
              <div className="toolbar-left">
                <button type="button" className="btn btn-outline btn-sm mobile-only" onClick={() => setFiltersOpen(true)}>
                  <Icon name="sliders" size={16} /> ตัวกรอง
                  {activeFilterCount ? <span className="badge-dot">{activeFilterCount}</span> : null}
                </button>
                <div className="view-toggle">
                  <button
                    type="button"
                    className={view === 'grid' ? 'active' : ''}
                    onClick={() => setView('grid')}
                    aria-label="มุมมองตาราง"
                  >
                    <Icon name="grid" size={16} />
                  </button>
                  <button
                    type="button"
                    className={view === 'list' ? 'active' : ''}
                    onClick={() => setView('list')}
                    aria-label="มุมมองรายการ"
                  >
                    <Icon name="list" size={16} />
                  </button>
                </div>
                <span className="result-count">{result ? `${formatNumber(result.total)} รายการ` : '…'}</span>
              </div>
              <label className="sort-control">
                <Icon name="sliders" size={15} />
                <span>เรียงตาม</span>
                <select value={sort} onChange={(event) => update('sort', event.target.value)}>
                  {q ? <option value="relevance">ความเกี่ยวข้อง</option> : null}
                  {SORTS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {activeChips.length ? (
              <div className="active-filters">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="filter-chip"
                    onClick={() => update(chip.key, null)}
                    title="ลบตัวกรองนี้"
                  >
                    {chip.label} <Icon name="close" size={13} />
                  </button>
                ))}
                <button type="button" className="link-button" onClick={clearAll}>
                  ล้างทั้งหมด
                </button>
              </div>
            ) : null}

            {error ? (
              <div className="alert alert-error">
                <Icon name="warning" size={18} /> {error}{' '}
                <button type="button" className="link-button" onClick={() => setParams(new URLSearchParams(params), { replace: true })}>
                  ลองอีกครั้ง
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className={view === 'grid' ? 'pub-grid' : 'pub-list'}>
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="pub-card skeleton-card" />
                ))}
              </div>
            ) : result && result.items.length ? (
              <div className={view === 'grid' ? 'pub-grid' : 'pub-list'}>
                {result.items.map((item, index) => (
                  <PublicationCard key={item.id} publication={item} variant={view === 'grid' ? 'default' : 'row'} index={index} />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon name="search" size={30} />
                </span>
                <h2>ไม่พบรายการที่ตรงกับเงื่อนไข</h2>
                <p>ลองใช้คำค้นที่กว้างขึ้น ลบตัวกรองบางรายการ หรือค้นหาด้วยชื่อผู้แต่ง</p>
                <button type="button" className="btn btn-primary" onClick={clearAll}>
                  ล้างตัวกรองทั้งหมด
                </button>
                {q && result?.terms?.length ? (
                  <div className="empty-suggest">
                    <span>คำที่ระบบวิเคราะห์ได้:</span>
                    {result.terms.map((term) => (
                      <span key={term} className="chip chip-ghost">
                        {term}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {pages > 1 ? (
              <nav className="pagination" aria-label="การแบ่งหน้า">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page <= 1}
                  onClick={() => update('page', String(page - 1))}
                >
                  <Icon name="chevronLeft" size={16} /> ก่อนหน้า
                </button>
                <div className="page-numbers">
                  {Array.from({ length: pages }).slice(0, 7).map((_, index) => {
                    const pageNumber = index + 1;
                    return (
                      <button
                        key={pageNumber}
                        type="button"
                        className={pageNumber === page ? 'active' : ''}
                        onClick={() => update('page', String(pageNumber))}
                      >
                        {pageNumber}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={page >= pages}
                  onClick={() => update('page', String(page + 1))}
                >
                  ถัดไป <Icon name="chevronRight" size={16} />
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
