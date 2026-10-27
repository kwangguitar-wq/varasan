import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Publication } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Icon } from '../components/Icons';
import { Cover, PublicationCard, ProgressBar, TypeBadge } from '../components/PublicationCard';
import { SectionHeading } from '../components/Shell';
import { biblioYear, fileLabels, formatDate, formatFileSize, formatNumber, typeLabels } from '../lib/format';

export function ItemDetail() {
  const { slug = '' } = useParams();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [related, setRelated] = useState<Publication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const viewTracked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPublication(null);
    setError(null);
    api
      .get<{ publication: Publication; related: Publication[] }>(`/api/publications/${slug}`)
      .then((data) => {
        if (cancelled) return;
        setPublication(data.publication);
        setRelated(data.related);
        setBookmarked(Boolean(data.publication.bookmarked));
        const key = `lumen-view-${data.publication.id}`;
        if (!viewTracked.current && !sessionStorage.getItem(key)) {
          viewTracked.current = true;
          sessionStorage.setItem(key, '1');
          void api.post(`/api/publications/${data.publication.id}/event`, { type: 'view' }).catch(() => null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const toggleBookmark = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/item/${slug}` } });
      return;
    }
    if (!publication) return;
    try {
      const data = await api.post<{ bookmarked: boolean }>(`/api/publications/${publication.id}/bookmark`);
      setBookmarked(data.bookmarked);
      toast.show(data.bookmarked ? 'บันทึกลงชั้นหนังสือแล้ว' : 'นำออกจากชั้นหนังสือแล้ว', 'success');
    } catch (err) {
      toast.show((err as Error).message, 'error');
    }
  };

  const download = () => {
    if (!publication?.fileUrl) {
      toast.show('เอกสารนี้ยังไม่มีไฟล์ให้ดาวน์โหลด', 'error');
      return;
    }
    setDownloading(true);
    const anchor = document.createElement('a');
    anchor.href = `/api/publications/${publication.id}/download`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setPublication((current) => (current ? { ...current, downloads: current.downloads + 1 } : current));
    window.setTimeout(() => setDownloading(false), 1400);
    toast.show('กำลังเริ่มดาวน์โหลดไฟล์', 'success');
  };

  const share = async () => {
    if (!publication) return;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: publication.title, text: publication.excerpt ?? '', url });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard?.writeText(url);
    toast.show('คัดลอกลิงก์แล้ว', 'success');
  };

  const copyCitation = async () => {
    if (!publication) return;
    const authors = publication.author ?? 'ไม่ระบุผู้แต่ง';
    const citation = `${authors} (${publication.year ?? 'ม.ป.ป.'}). ${publication.title}. ${publication.publisher ?? ''}. ${publication.issn ? `ISSN ${publication.issn}` : publication.isbn ? `ISBN ${publication.isbn}` : ''}`;
    await navigator.clipboard?.writeText(citation.replace(/\s+/g, ' ').trim());
    toast.show('คัดลอกการอ้างอิงแบบ APA แล้ว', 'success');
  };

  if (error) {
    return (
      <div className="section-inner page-pad">
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="warning" size={28} />
          </span>
          <h2>ไม่พบเอกสารนี้</h2>
          <p>{error}</p>
          <Link to="/library" className="btn btn-primary">
            กลับไปที่คลังสารสนเทศ
          </Link>
        </div>
      </div>
    );
  }

  if (!publication) {
    return (
      <div className="section-inner detail-skeleton">
        <div className="skeleton-block detail-skeleton-cover" />
        <div className="detail-skeleton-body">
          <div className="skeleton-block" style={{ height: 18, width: 120 }} />
          <div className="skeleton-block" style={{ height: 44, width: '80%' }} />
          <div className="skeleton-block" style={{ height: 16, width: '50%' }} />
          <div className="skeleton-block" style={{ height: 160 }} />
        </div>
      </div>
    );
  }

  const accent = publication.category?.accent ?? '#0f766e';
  const progress = publication.progress;

  return (
    <>
      <section className="detail-hero" style={{ '--accent': accent } as React.CSSProperties}>
        <div className="detail-hero-glow" aria-hidden="true" />
        <div className="section-inner">
          <nav className="breadcrumb">
            <Link to="/">หน้าแรก</Link>
            <Icon name="chevronRight" size={13} />
            <Link to="/library">คลังสารสนเทศ</Link>
            <Icon name="chevronRight" size={13} />
            <Link to={`/library?category=${publication.category?.slug ?? ''}`}>{publication.category?.name ?? 'สารสนเทศ'}</Link>
          </nav>

          {publication.status === 'draft' ? (
            <div className="alert alert-warning">
              <Icon name="warning" size={18} /> เอกสารนี้ยังเป็นฉบับร่าง — มองเห็นได้เฉพาะบุคลากรเท่านั้น
            </div>
          ) : null}

          <div className="detail-top">
            <div className="detail-cover-wrap">
              <div className="detail-cover-frame">
                <Cover publication={publication} className="detail-cover" sizes="320px" />
              </div>
              <div className="detail-file-badge">
                <Icon name={publication.fileType === 'epub' ? 'journal' : publication.fileType === 'flipbook' ? 'flip' : 'file'} size={15} />
                {fileLabels[publication.fileType ?? 'pdf'] ?? 'ไฟล์'}
                {publication.pages ? ` · ${publication.pages} หน้า` : ''}
              </div>
            </div>

            <div className="detail-info">
              <div className="detail-badges">
                <TypeBadge type={publication.type} />
                {publication.featured ? (
                  <span className="chip chip-soft">
                    <Icon name="sparkle" size={13} /> บรรณารักษ์แนะนำ
                  </span>
                ) : null}
                <span className="chip chip-soft">
                  <Icon name="globe" size={13} /> {publication.language === 'th' ? 'ภาษาไทย' : 'English'}
                </span>
              </div>
              <h1>{publication.title}</h1>
              {publication.subtitle ? <p className="detail-subtitle">{publication.subtitle}</p> : null}
              <p className="detail-author">
                <Icon name="user" size={16} /> {publication.author ?? 'ไม่ระบุผู้แต่ง'}
              </p>

              <div className="detail-facts">
                <div>
                  <span>ปีที่พิมพ์</span>
                  <strong>{biblioYear(publication.year)}</strong>
                </div>
                <div>
                  <span>{publication.issn ? 'ISSN' : 'ISBN'}</span>
                  <strong>{publication.issn ?? publication.isbn ?? '—'}</strong>
                </div>
                <div>
                  <span>จำนวนหน้า</span>
                  <strong>{formatNumber(publication.pages)}</strong>
                </div>
                <div>
                  <span>เวลาในการอ่าน</span>
                  <strong>~{publication.readingMinutes} นาที</strong>
                </div>
              </div>

              <div className="detail-actions">
                <Link to={`/read/${publication.slug}`} className="btn btn-primary btn-lg">
                  <Icon name="play" size={18} filled /> {progress ? 'อ่านต่อ' : 'เปิดอ่านเลย'}
                </Link>
                <button type="button" className="btn btn-outline btn-lg" onClick={download} disabled={downloading}>
                  <Icon name="download" size={18} /> {downloading ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลด'}
                </button>
                <button
                  type="button"
                  className={`icon-button icon-button-lg ${bookmarked ? 'active' : ''}`}
                  onClick={toggleBookmark}
                  aria-label={bookmarked ? 'นำออกจากชั้นหนังสือ' : 'บันทึกไว้'}
                  title={bookmarked ? 'นำออกจากชั้นหนังสือ' : 'บันทึกไว้'}
                >
                  <Icon name="bookmark" size={19} filled={bookmarked} />
                </button>
                <button type="button" className="icon-button icon-button-lg" onClick={share} aria-label="แชร์" title="แชร์">
                  <Icon name="share" size={19} />
                </button>
              </div>

              {progress ? (
                <div className="detail-progress">
                  <div className="detail-progress-head">
                    <span>อ่านแล้ว {Math.round(Math.min(1, progress.progress) * 100)}%</span>
                    <span>หน้าที่ {Math.min(progress.page, publication.pages || progress.page)}</span>
                  </div>
                  <ProgressBar value={Math.min(1, progress.progress)} />
                </div>
              ) : null}

              <div className="detail-metrics">
                <span>
                  <Icon name="eye" size={15} /> {formatNumber(publication.views)} ครั้ง
                </span>
                <span>
                  <Icon name="download" size={15} /> {formatNumber(publication.downloads)} ดาวน์โหลด
                </span>
                <span>
                  <Icon name="clock" size={15} /> เผยแพร่ {formatDate(publication.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section detail-body-section">
        <div className="section-inner detail-layout">
          <div className="detail-main">
            {publication.abstract ? (
              <div className="prose-card">
                <h2>บทคัดย่อ</h2>
                <p className="abstract-text">{publication.abstract}</p>
                {publication.description ? <p className="muted-text">{publication.description}</p> : null}
              </div>
            ) : null}

            {publication.keywords?.length ? (
              <div className="prose-card">
                <h2>คำสำคัญที่ดึงจากเนื้อหา</h2>
                <p className="muted-text">ระบบจัดทำดัชนีคำสำคัญอัตโนมัติจากการวิเคราะห์เนื้อหาภายในเล่ม</p>
                <div className="keyword-cloud">
                  {publication.keywords.slice(0, 18).map((keyword) => (
                    <Link key={keyword.term} to={`/library?q=${encodeURIComponent(keyword.term)}`} className="keyword-pill">
                      {keyword.term}
                      <em>{keyword.count}</em>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {publication.tags?.length ? (
              <div className="prose-card">
                <h2>แท็กและหัวเรื่อง</h2>
                <div className="filter-chips">
                  {publication.tags.map((tag) => (
                    <Link key={tag.id} to={`/library?tag=${encodeURIComponent(tag.name)}`} className="chip chip-outline">
                      <Icon name="tag" size={13} /> {tag.name}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="prose-card">
              <div className="prose-card-head">
                <h2>รายละเอียดบรรณานุกรม</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copyCitation}>
                  <Icon name="share" size={15} /> คัดลอกการอ้างอิง
                </button>
              </div>
              <dl className="biblio-grid">
                <div>
                  <dt>ชื่อเรื่อง</dt>
                  <dd>{publication.title}</dd>
                </div>
                <div>
                  <dt>ผู้แต่ง</dt>
                  <dd>{publication.author ?? '—'}</dd>
                </div>
                <div>
                  <dt>สำนักพิมพ์</dt>
                  <dd>{publication.publisher ?? '—'}</dd>
                </div>
                <div>
                  <dt>ปีที่พิมพ์</dt>
                  <dd>{biblioYear(publication.year)}</dd>
                </div>
                {publication.issn ? (
                  <div>
                    <dt>ISSN</dt>
                    <dd>{publication.issn}</dd>
                  </div>
                ) : null}
                {publication.isbn ? (
                  <div>
                    <dt>ISBN</dt>
                    <dd>{publication.isbn}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>หมวดหมู่</dt>
                  <dd>{publication.category?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>ภาษา</dt>
                  <dd>{publication.language === 'th' ? 'ไทย' : 'อังกฤษ'}</dd>
                </div>
                <div>
                  <dt>จำนวนหน้า</dt>
                  <dd>{formatNumber(publication.pages)} หน้า</dd>
                </div>
                <div>
                  <dt>ขนาดไฟล์</dt>
                  <dd>{formatFileSize(publication.fileSize)}</dd>
                </div>
                <div>
                  <dt>รูปแบบไฟล์</dt>
                  <dd>{fileLabels[publication.fileType ?? 'pdf'] ?? '—'}</dd>
                </div>
                <div>
                  <dt>เผยแพร่เมื่อ</dt>
                  <dd>{formatDate(publication.createdAt)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <aside className="detail-aside">
            <div className="aside-card aside-read">
              <div className="aside-read-head">
                <span className="file-pill pdf">อ่านออนไลน์</span>
                <span>{typeLabels[publication.type]}</span>
              </div>
              <p>เปิดอ่านได้ทันที รองรับการบันทึกหน้าล่าสุดและโหมดกลางคืนบนมือถือ</p>
              <Link to={`/read/${publication.slug}`} className="btn btn-primary btn-block">
                <Icon name="play" size={17} filled /> เปิดหน้าอ่าน
              </Link>
              <ul className="aside-list">
                <li>
                  <Icon name="check" size={15} /> ปรับขนาดตัวอักษรได้
                </li>
                <li>
                  <Icon name="check" size={15} /> โหมดพลิกหน้าสำหรับ Flipbook
                </li>
                <li>
                  <Icon name="check" size={15} /> ทำงานบน Android และ iOS
                </li>
              </ul>
            </div>

            <div className="aside-card">
              <h3>สถิติการเข้าถึง</h3>
              <div className="aside-stats">
                <div>
                  <span>เข้าชม</span>
                  <strong>{formatNumber(publication.views)}</strong>
                </div>
                <div>
                  <span>เข้าอ่าน</span>
                  <strong>{formatNumber(publication.reads)}</strong>
                </div>
                <div>
                  <span>ดาวน์โหลด</span>
                  <strong>{formatNumber(publication.downloads)}</strong>
                </div>
              </div>
            </div>

            {publication.publisher ? (
              <div className="aside-card aside-publisher">
                <span className="eyebrow">จัดทำโดย</span>
                <h3>{publication.publisher}</h3>
                <p>เผยแพร่ผ่าน Lumen Library</p>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      {related.length ? (
        <section className="section section-tinted">
          <div className="section-inner">
            <SectionHeading
              eyebrow="อ่านต่อ"
              title="รายการที่เกี่ยวข้อง"
              action={
                <Link to={`/library?category=${publication.category?.slug ?? ''}`} className="link-arrow">
                  ดูเพิ่มเติม <Icon name="arrowRight" size={16} />
                </Link>
              }
            />
            <div className="pub-grid related-grid">
              {related.map((item, index) => (
                <PublicationCard key={item.id} publication={item} index={index} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
