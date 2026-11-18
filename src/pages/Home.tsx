import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Overview, Shelf } from '../lib/types';
import { useAuth } from '../lib/auth';
import { SearchBar } from '../components/SearchBar';
import { SectionHeading } from '../components/Shell';
import { Cover, PublicationCard, ProgressBar, TypeBadge } from '../components/PublicationCard';
import { Icon } from '../components/Icons';
import type { IconName } from '../components/Icons';
import { formatCompact, formatNumber } from '../lib/format';

const CATEGORY_ICONS: Record<string, IconName> = {
  journal: 'journal',
  flask: 'flask',
  book: 'library',
  sparkle: 'sparkle',
  chart: 'chart',
  heart: 'heart',
};

const FEATURES = [
  {
    icon: 'search' as IconName,
    title: 'สืบค้นอัจฉริยะ',
    description: 'ค้นด้วยคำสำคัญจากเนื้อหาจริง ตัดคำภาษาไทยอัตโนมัติ พร้อมตัวกรองผู้แต่ง ปี ISSN/ISBN',
    accent: '#0f766e',
  },
  {
    icon: 'flip' as IconName,
    title: 'อ่านได้ทุกอุปกรณ์',
    description: 'รองรับ PDF, ePub และ Flipbook ปรับขนาดตัวอักษร โหมดกลางคืน และบันทึกหน้าล่าสุด',
    accent: '#4338ca',
  },
  {
    icon: 'chart' as IconName,
    title: 'สถิติเพื่อผู้บริหาร',
    description: 'แดชบอร์ดยอดอ่าน ดาวน์โหลด และหนังสือยอดนิยม พร้อมส่งออกภาพรวมให้ทีมงาน',
    accent: '#b45309',
  },
];

export function Home() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    api
      .get<Overview>('/api/overview')
      .then(setOverview)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!user) {
      setShelf(null);
      return;
    }
    api.get<Shelf>('/api/auth/me/shelf').then(setShelf).catch(() => setShelf(null));
  }, [user]);

  const heroCovers = overview?.featured.slice(0, 3) ?? [];
  const reading = shelf?.reading.filter((item) => item.progress) ?? [];

  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <span className="hero-orb hero-orb-1" />
          <span className="hero-orb hero-orb-2" />
          <span className="hero-grid" />
        </div>
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-pill">
              <span className="pulse-dot" /> คลังความรู้ดิจิทัล · เปิดให้บริการทุกคน
            </span>
            <h1>
              เปิดประตูสู่
              <span className="hero-emphasis">โลกของความรู้</span>
              ที่อ่านได้ทุกที่ทุกเวลา
            </h1>
            <p className="hero-lede">
              วารสารเทศบาลนครแม่สอด แผนพัฒนาเทศบาลนครแม่สอด และหนังสืออิเล็กทรอนิกส์
              พร้อมระบบสืบค้นอัจฉริยะที่เข้าใจภาษาไทย และประสบการณ์อ่านที่ลื่นไหลบนมือถือ
            </p>
            <div className="hero-search">
              <SearchBar variant="hero" autoFocus={false} />
            </div>
            <div className="hero-quick">
              <span>ลองค้นหา:</span>
              {(overview?.keywords ?? []).slice(0, 4).map((keyword) => (
                <Link key={keyword.term} to={`/library?q=${encodeURIComponent(keyword.term)}`} className="chip chip-ghost">
                  {keyword.term}
                </Link>
              ))}
            </div>
            <div className="hero-stats">
              <div>
                <strong>{overview ? formatNumber(overview.stats.titles) : '—'}</strong>
                <span>รายการในคลัง</span>
              </div>
              <div>
                <strong>{overview ? formatCompact(overview.stats.reads) : '—'}</strong>
                <span>ยอดเข้าอ่าน</span>
              </div>
              <div>
                <strong>{overview ? formatNumber(overview.stats.categories) : '—'}</strong>
                <span>หมวดหมู่</span>
              </div>
              <div>
                <strong>{overview ? formatCompact(overview.stats.keywords) : '—'}</strong>
                <span>คำสำคัญที่จัดทำดัชนี</span>
              </div>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-stack">
              {heroCovers.map((item, index) => (
                <Link
                  key={item.id}
                  to={`/item/${item.slug}`}
                  className={`hero-cover hero-cover-${index}`}
                  tabIndex={-1}
                >
                  <Cover publication={item} />
                  <span className="hero-cover-label">{item.category?.name}</span>
                </Link>
              ))}
              {!heroCovers.length
                ? [0, 1, 2].map((index) => <div key={index} className={`hero-cover hero-cover-${index} skeleton-cover`} />)
                : null}
            </div>
            <div className="floating-card floating-card-read">
              <span className="floating-icon">
                <Icon name="bookmark" size={16} />
              </span>
              <div>
                <small>อ่านต่อจากที่ค้างไว้</small>
                <strong>{reading[0]?.title.slice(0, 26) ?? 'บันทึกความคืบหน้าอัตโนมัติ'}</strong>
                <ProgressBar value={reading[0]?.progress?.progress ?? 0.42} />
              </div>
            </div>
            <div className="floating-card floating-card-types">
              <div className="file-pills">
                <span className="file-pill pdf">PDF</span>
                <span className="file-pill epub">ePub</span>
                <span className="file-pill flip">Flipbook</span>
              </div>
              <small>รองรับหลายรูปแบบในที่เดียว</small>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-categories">
        <div className="section-inner">
          <SectionHeading
            eyebrow="หมวดหมู่"
            title="เลือกเส้นทางความรู้ที่ใช่สำหรับคุณ"
            description="จัดหมวดหมู่โดยบรรณารักษ์ เพื่อให้ค้นพบสารสนเทศได้ตรงความสนใจ"
            action={
              <Link to="/library" className="link-arrow">
                ดูทั้งหมด <Icon name="arrowRight" size={16} />
              </Link>
            }
          />
          <div className="category-grid">
            {(overview?.categories ?? Array.from({ length: 6 })).map((category, index) =>
              category ? (
                <Link
                  key={category.id}
                  to={`/library?category=${category.slug}`}
                  className="category-card"
                  style={{ '--accent': category.accent } as React.CSSProperties}
                >
                  <span className="category-icon">
                    <Icon name={CATEGORY_ICONS[category.icon] ?? 'library'} size={22} />
                  </span>
                  <div>
                    <h3>{category.name}</h3>
                    <p>{category.description}</p>
                  </div>
                  <span className="category-count">{formatNumber(category.count ?? 0)} รายการ</span>
                  <Icon name="arrowRight" size={18} className="category-arrow" />
                </Link>
              ) : (
                <div key={index} className="category-card skeleton-card" />
              ),
            )}
          </div>
        </div>
      </section>

      {error ? (
        <div className="section-inner">
          <div className="alert alert-error">
            <Icon name="warning" size={18} /> โหลดข้อมูลไม่สำเร็จ: {error}
          </div>
        </div>
      ) : null}

      <section className="section">
        <div className="section-inner">
          <SectionHeading
            eyebrow="คัดสรรโดยบรรณารักษ์"
            title="รายการแนะนำประจำสัปดาห์"
            description="ผลงานเด่นที่ทีมบรรณาธิการคัดเลือกเป็นพิเศษ"
            action={
              <Link to="/library?sort=popular" className="link-arrow">
                ดูยอดนิยม <Icon name="arrowRight" size={16} />
              </Link>
            }
          />
          <div className="featured-track">
            {(overview?.featured ?? []).map((item, index) => (
              <PublicationCard key={item.id} publication={item} index={index} />
            ))}
            {!overview
              ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="pub-card skeleton-card" />)
              : null}
          </div>
        </div>
      </section>

      {reading.length ? (
        <section className="section section-tinted">
          <div className="section-inner">
            <SectionHeading
              eyebrow={`ยินดีต้อนรับกลับ ${user?.name.split(' ')[0] ?? ''}`}
              title="อ่านต่อจากที่ค้างไว้"
              action={
                <Link to="/account" className="link-arrow">
                  ชั้นหนังสือของฉัน <Icon name="arrowRight" size={16} />
                </Link>
              }
            />
            <div className="continue-grid">
              {reading.slice(0, 4).map((item) => (
                <Link key={item.id} to={`/read/${item.slug}`} className="continue-card">
                  <Cover publication={item} className="continue-cover" />
                  <div className="continue-body">
                    <TypeBadge type={item.type} />
                    <h3>{item.title}</h3>
                    <p>{item.author}</p>
                    <ProgressBar value={Math.min(1, item.progress?.progress ?? 0)} />
                    <span className="continue-meta">
                      อ่านต่อหน้า {Math.min(item.progress?.page ?? 1, item.pages)} ·{' '}
                      {Math.round(Math.min(1, item.progress?.progress ?? 0) * 100)}%
                    </span>
                  </div>
                  <span className="continue-play">
                    <Icon name="play" size={18} filled />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-inner">
          <div className="split-section">
            <div className="latest-column">
              <SectionHeading
                eyebrow="มาใหม่"
                title="เพิ่มเข้าคลังล่าสุด"
                action={
                  <Link to="/library?sort=newest" className="link-arrow">
                    ดูทั้งหมด <Icon name="arrowRight" size={16} />
                  </Link>
                }
              />
              <div className="latest-grid">
                {(overview?.latest ?? []).slice(0, 4).map((item, index) => (
                  <PublicationCard key={item.id} publication={item} index={index} />
                ))}
                {!overview
                  ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="pub-card skeleton-card" />)
                  : null}
              </div>
            </div>
            <aside className="popular-column">
              <SectionHeading eyebrow="จัดอันดับ" title="ยอดนิยมประจำเดือน" />
              <div className="popular-list">
                {(overview?.popular ?? []).slice(0, 6).map((item, index) => (
                  <Link key={item.id} to={`/item/${item.slug}`} className="popular-item">
                    <span className="popular-rank">{String(index + 1).padStart(2, '0')}</span>
                    <Cover publication={item} className="popular-cover" />
                    <div className="popular-body">
                      <h3>{item.title}</h3>
                      <p>
                        {item.category?.name} · {item.year ? `พ.ศ. ${item.year}` : 'ไม่ระบุปี'}
                      </p>
                      <span className="popular-stats">
                        <Icon name="eye" size={13} /> {formatCompact(item.reads)}{' '}
                        <Icon name="download" size={13} /> {formatCompact(item.downloads)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="section section-tinted">
        <div className="section-inner">
          <SectionHeading
            eyebrow="วารสารและนิตยสาร"
            title="ฉบับล่าสุดบนชั้น"
            description="ติดตามบทความวิชาการและเรื่องเล่าวัฒนธรรมฉบับใหม่"
            action={
              <Link to="/library?type=journal" className="link-arrow">
                วารสารทั้งหมด <Icon name="arrowRight" size={16} />
              </Link>
            }
          />
          <div className="journal-grid">
            {(overview?.journals ?? []).map((item) => (
              <Link key={item.id} to={`/item/${item.slug}`} className="journal-card">
                <Cover publication={item} className="journal-cover" />
                <div className="journal-body">
                  <TypeBadge type={item.type} />
                  <h3>{item.title}</h3>
                  <p>{item.subtitle}</p>
                  <div className="journal-meta">
                    <span>{item.year ? `พ.ศ. ${item.year}` : '—'}</span>
                    <span>{item.issn ? `ISSN ${item.issn}` : item.isbn ? `ISBN ${item.isbn}` : ''}</span>
                  </div>
                  <span className="journal-read">
                    อ่านฉบับนี้ <Icon name="arrowRight" size={15} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-inner">
          <div className="features-grid">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="feature-card" style={{ '--accent': feature.accent } as React.CSSProperties}>
                <span className="feature-icon">
                  <Icon name={feature.icon} size={22} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
          <div className="cta-band">
            <div>
              <span className="eyebrow">สำหรับหน่วยงานและบรรณาธิการ</span>
              <h2>นำงานวิจัยและวารสารของคุณขึ้นชั้นดิจิทัล</h2>
              <p>อัปโหลด PDF, ePub หรือ Flipbook จัดหมวดหมู่ และติดตามสถิติการเข้าถึงได้ในที่เดียว</p>
            </div>
            <div className="cta-actions">
              <Link to="/register" className="btn btn-primary">
                สมัครสมาชิกฟรี <Icon name="arrowRight" size={16} />
              </Link>
              <Link to="/library" className="btn btn-ghost">
                สำรวจคลังสารสนเทศ
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
