import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { AnalyticsSummary } from '../../lib/types';
import { AdminLayout } from '../../components/AdminLayout';
import { Icon } from '../../components/Icons';
import type { IconName } from '../../components/Icons';
import { Donut, Sparkline, TrendChart } from '../../components/Charts';
import { Cover } from '../../components/PublicationCard';
import { formatCompact, formatFileSize, formatNumber, timeAgo, truncate } from '../../lib/format';

const EVENT_LABELS: Record<string, string> = {
  view: 'เข้าชม',
  read: 'เปิดอ่าน',
  download: 'ดาวน์โหลด',
  complete: 'อ่านจบ',
};

const EVENT_ICONS: Record<string, IconName> = {
  view: 'eye',
  read: 'library',
  download: 'download',
  complete: 'check',
};

export function AdminDashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<AnalyticsSummary>(`/api/analytics/summary?days=${days}`)
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  const stats = data
    ? [
        {
          label: 'ยอดเข้าอ่าน',
          value: data.totals.reads,
          delta: data.delta.reads,
          icon: 'library' as IconName,
          accent: '#0f766e',
          series: data.series.map((day) => day.reads),
        },
        {
          label: 'ยอดดาวน์โหลด',
          value: data.totals.downloads,
          delta: data.delta.downloads,
          icon: 'download' as IconName,
          accent: '#f59e0b',
          series: data.series.map((day) => day.downloads),
        },
        {
          label: 'ยอดเข้าชม',
          value: data.totals.views,
          delta: data.delta.views,
          icon: 'eye' as IconName,
          accent: '#6366f1',
          series: data.series.map((day) => day.views),
        },
        {
          label: 'ผู้อ่านที่มีปฏิสัมพันธ์',
          value: data.totals.activeReaders,
          delta: null,
          icon: 'users' as IconName,
          accent: '#be185d',
          series: data.series.map((day) => day.reads),
        },
      ]
    : [];

  return (
    <AdminLayout
      title="ภาพรวมการใช้งาน"
      description="ติดตามยอดอ่าน ดาวน์โหลด และประสิทธิภาพของคลังสารสนเทศ"
      actions={
        <div className="range-switch">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              type="button"
              className={days === value ? 'active' : ''}
              onClick={() => setDays(value)}
            >
              {value} วัน
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <div className="alert alert-error">
          <Icon name="warning" size={18} /> {error}
        </div>
      ) : null}

      <div className="stat-grid">
        {loading || !data
          ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="stat-card skeleton-card" style={{ height: 120 }} />)
          : stats.map((stat) => (
              <div key={stat.label} className="stat-card" style={{ '--accent': stat.accent } as React.CSSProperties}>
                <div className="stat-head">
                  <span className="stat-icon">
                    <Icon name={stat.icon} size={19} />
                  </span>
                  {stat.delta !== null ? (
                    <span className={`stat-delta ${stat.delta >= 0 ? 'up' : 'down'}`}>
                      <Icon name={stat.delta >= 0 ? 'arrowUp' : 'chevronDown'} size={13} />
                      {Math.abs(stat.delta)}%
                    </span>
                  ) : null}
                </div>
                <strong>{formatNumber(stat.value)}</strong>
                <span className="stat-label">{stat.label}</span>
                <Sparkline values={stat.series} color={stat.accent} />
              </div>
            ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel panel-wide">
          <div className="panel-head">
            <div>
              <h2>แนวโน้มการใช้งาน</h2>
              <p>เปรียบเทียบยอดอ่าน เข้าชม และดาวน์โหลดใน {days} วันที่ผ่านมา</p>
            </div>
            {data ? (
              <span className="chip chip-soft">
                <Icon name="calendar" size={13} /> {data.range.start} — {data.range.end}
              </span>
            ) : null}
          </div>
          {data ? (
            <TrendChart data={data.series} series={['reads', 'views', 'downloads']} />
          ) : (
            <div className="skeleton-card" style={{ height: 260 }} />
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>สัดส่วนตามหมวดหมู่</h2>
              <p>ยอดอ่านสะสม</p>
            </div>
          </div>
          {data ? (
            <Donut
              total={data.categorySplit.reduce((sum, category) => sum + category.reads, 0)}
              caption="ยอดอ่านรวม"
              segments={data.categorySplit.slice(0, 6).map((category) => ({
                label: category.name,
                value: category.reads,
                color: category.accent,
              }))}
            />
          ) : (
            <div className="skeleton-card" style={{ height: 240 }} />
          )}
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>รายการยอดนิยม</h2>
              <p>เรียงตามปฏิสัมพันธ์ในช่วง {days} วัน</p>
            </div>
            <Link to="/admin/content" className="link-arrow">
              จัดการเนื้อหา <Icon name="arrowRight" size={15} />
            </Link>
          </div>
          <div className="top-list">
            {(data?.topPublications ?? []).map((item, index) => (
              <div key={item.id} className="top-item">
                <span className="top-rank">{String(index + 1).padStart(2, '0')}</span>
                <Cover
                  publication={{ title: item.title, coverUrl: item.cover_url, category: null, type: item.type as never }}
                  className="top-cover"
                />
                <div className="top-body">
                  <Link to={`/item/${item.slug}`}>
                    <h3>{item.title}</h3>
                  </Link>
                  <p>{truncate(item.author, 40)}</p>
                  <div className="top-stats">
                    <span>
                      <Icon name="eye" size={13} /> {formatNumber(item.reads)}
                    </span>
                    <span>
                      <Icon name="download" size={13} /> {formatNumber(item.downloads)}
                    </span>
                    <span>
                      <Icon name="activity" size={13} /> {formatNumber(item.period_events)} ครั้ง
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {!data ? <div className="skeleton-card" style={{ height: 300 }} /> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>กิจกรรมล่าสุด</h2>
              <p>เหตุการณ์จากผู้ใช้แบบเรียลไทม์</p>
            </div>
          </div>
          <div className="activity-list">
            {(data?.recentActivity ?? []).map((event, index) => (
              <div key={index} className="activity-item">
                <span className={`activity-icon activity-${event.type}`}>
                  <Icon name={EVENT_ICONS[event.type] ?? 'activity'} size={15} />
                </span>
                <div>
                  <p>
                    <strong>{event.user_name ?? 'ผู้เยี่ยมชม'}</strong> {EVENT_LABELS[event.type] ?? event.type}{' '}
                    {event.publication_slug ? (
                      <Link to={`/item/${event.publication_slug}`}>{truncate(event.publication_title, 34)}</Link>
                    ) : (
                      'เอกสาร'
                    )}
                  </p>
                  <small>{timeAgo(event.created_at)}</small>
                </div>
              </div>
            ))}
            {!data ? <div className="skeleton-card" style={{ height: 300 }} /> : null}
          </div>
        </section>
      </div>

      <div className="dashboard-grid dashboard-grid-3">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>คำสำคัญที่ถูกค้นมาก</h2>
              <p>จากดัชนีคำสำคัญทั้งคลัง</p>
            </div>
          </div>
          <div className="keyword-cloud">
            {(data?.keywords ?? []).slice(0, 20).map((keyword) => (
              <span key={keyword.term} className="keyword-pill">
                {keyword.term}
                <em>{formatCompact(keyword.count)}</em>
              </span>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>ภาพรวมคลัง</h2>
              <p>สถานะทรัพยากรสารสนเทศ</p>
            </div>
          </div>
          <div className="mini-stats">
            <div>
              <span>เผยแพร่แล้ว</span>
              <strong>{formatNumber(data?.library.published)}</strong>
            </div>
            <div>
              <span>ฉบับร่าง</span>
              <strong>{formatNumber(data?.library.drafts)}</strong>
            </div>
            <div>
              <span>ผู้อ่านในระบบ</span>
              <strong>{formatNumber(data?.library.readers)}</strong>
            </div>
            <div>
              <span>พื้นที่ไฟล์ทั้งหมด</span>
              <strong>{formatFileSize(data?.library.storage)}</strong>
            </div>
            <div>
              <span>ยอดอ่านสะสม</span>
              <strong>{formatNumber(data?.library.allReads)}</strong>
            </div>
            <div>
              <span>ดาวน์โหลดสะสม</span>
              <strong>{formatNumber(data?.library.allDownloads)}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>ทางลัด</h2>
              <p>งานที่ใช้บ่อย</p>
            </div>
          </div>
          <div className="quick-actions">
            <Link to="/admin/content/new" className="quick-action">
              <span>
                <Icon name="plus" size={18} />
              </span>
              <div>
                <strong>เพิ่มรายการใหม่</strong>
                <small>อัปโหลด PDF / ePub / Flipbook</small>
              </div>
              <Icon name="chevronRight" size={16} />
            </Link>
            <Link to="/admin/content?status=draft" className="quick-action">
              <span>
                <Icon name="edit" size={18} />
              </span>
              <div>
                <strong>ตรวจฉบับร่าง</strong>
                <small>{formatNumber(data?.library.drafts)} รายการรอเผยแพร่</small>
              </div>
              <Icon name="chevronRight" size={16} />
            </Link>
            <Link to="/admin/users" className="quick-action">
              <span>
                <Icon name="users" size={18} />
              </span>
              <div>
                <strong>จัดการสิทธิ์ผู้ใช้</strong>
                <small>Admin · Editor · Reader</small>
              </div>
              <Icon name="chevronRight" size={16} />
            </Link>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
