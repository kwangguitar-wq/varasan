import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Shelf } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Cover, ProgressBar, TypeBadge } from '../components/PublicationCard';
import { Icon } from '../components/Icons';
import { formatDate, initials, roleLabels } from '../lib/format';

export function Account() {
  const { user, counts, refresh, updateProfile } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'profile' ? 'profile' : 'shelf';
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ name: '', affiliation: '', bio: '', currentPassword: '', newPassword: '' });

  useEffect(() => {
    if (!user) return;
    setProfile({ name: user.name, affiliation: user.affiliation ?? '', bio: user.bio ?? '', currentPassword: '', newPassword: '' });
  }, [user]);

  const loadShelf = () => {
    setLoading(true);
    api
      .get<Shelf>('/api/auth/me/shelf')
      .then(setShelf)
      .catch(() => setShelf({ reading: [], saved: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadShelf();
  }, []);

  if (!user) return null;

  const removeSaved = async (publicationId: number) => {
    await api.post(`/api/publications/${publicationId}/bookmark`);
    toast.show('นำออกจากชั้นหนังสือแล้ว', 'success');
    loadShelf();
    void refresh();
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        name: profile.name,
        affiliation: profile.affiliation,
        bio: profile.bio,
        ...(profile.newPassword ? { currentPassword: profile.currentPassword, newPassword: profile.newPassword } : {}),
      });
      setProfile({ ...profile, currentPassword: '', newPassword: '' });
      toast.show('บันทึกข้อมูลโปรไฟล์แล้ว', 'success');
    } catch (error) {
      toast.show((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="account-hero">
        <div className="section-inner account-hero-inner">
          <span className="avatar avatar-xl" style={{ background: `hsl(${user.avatarHue} 55% 42%)` }}>
            {initials(user.name)}
          </span>
          <div className="account-hero-info">
            <span className="eyebrow">{roleLabels[user.role]}</span>
            <h1>{user.name}</h1>
            <p>{user.affiliation ?? 'ยังไม่ได้ระบุหน่วยงาน'} · สมาชิกตั้งแต่ {formatDate(user.createdAt)}</p>
            <div className="account-chips">
              <span className="chip chip-soft">
                <Icon name="bookmark" size={14} /> กำลังอ่าน {counts?.reading ?? 0} เล่ม
              </span>
              <span className="chip chip-soft">
                <Icon name="star" size={14} /> บันทึกไว้ {counts?.saved ?? 0} เล่ม
              </span>
              {user.role !== 'reader' ? (
                <Link to="/admin" className="chip chip-accent">
                  <Icon name="chart" size={14} /> ไปที่แดชบอร์ด
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-inner account-layout">
          <nav className="account-tabs">
            <button
              type="button"
              className={tab === 'shelf' ? 'active' : ''}
              onClick={() => setParams({ tab: 'shelf' }, { replace: true })}
            >
              <Icon name="bookmark" size={17} /> ชั้นหนังสือของฉัน
            </button>
            <button
              type="button"
              className={tab === 'profile' ? 'active' : ''}
              onClick={() => setParams({ tab: 'profile' }, { replace: true })}
            >
              <Icon name="settings" size={17} /> โปรไฟล์และการตั้งค่า
            </button>
          </nav>

          {tab === 'shelf' ? (
            <div className="account-content">
              <div className="shelf-section">
                <div className="shelf-head">
                  <div>
                    <h2>อ่านต่อ</h2>
                    <p>บันทึกความคืบหน้าโดยอัตโนมัติเมื่อคุณเปิดอ่าน</p>
                  </div>
                  <Link to="/library" className="btn btn-outline btn-sm">
                    <Icon name="plus" size={15} /> หาเรื่องใหม่
                  </Link>
                </div>
                {loading ? (
                  <div className="shelf-grid">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="skeleton-card" style={{ height: 180 }} />
                    ))}
                  </div>
                ) : shelf?.reading.length ? (
                  <div className="shelf-grid">
                    {shelf.reading.map((item) => (
                      <div key={item.id} className="shelf-card">
                        <Link to={`/read/${item.slug}`} className="shelf-cover-link">
                          <Cover publication={item} className="shelf-cover" />
                          <span className="shelf-play">
                            <Icon name="play" size={17} filled />
                          </span>
                        </Link>
                        <div className="shelf-body">
                          <TypeBadge type={item.type} />
                          <Link to={`/item/${item.slug}`}>
                            <h3>{item.title}</h3>
                          </Link>
                          <p>{item.author}</p>
                          <ProgressBar value={Math.min(1, item.progress?.progress ?? 0)} />
                          <div className="shelf-meta">
                            <span>หน้า {Math.min(item.progress?.page ?? 1, item.pages)} จาก {item.pages}</span>
                            <span>{Math.round(Math.min(1, item.progress?.progress ?? 0) * 100)}%</span>
                          </div>
                          <Link to={`/read/${item.slug}`} className="btn btn-primary btn-sm btn-block">
                            อ่านต่อ
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <Icon name="bookmark" size={26} />
                    <h3>ยังไม่มีเรื่องที่กำลังอ่าน</h3>
                    <p>เปิดอ่านรายการใดก็ได้ ระบบจะบันทึกหน้าล่าสุดให้คุณ</p>
                    <Link to="/library" className="btn btn-primary btn-sm">
                      ไปที่คลังสารสนเทศ
                    </Link>
                  </div>
                )}
              </div>

              <div className="shelf-section">
                <div className="shelf-head">
                  <div>
                    <h2>บันทึกไว้</h2>
                    <p>รายการที่คุณบันทึกไว้สำหรับอ่านภายหลัง</p>
                  </div>
                </div>
                {shelf?.saved.length ? (
                  <div className="saved-list">
                    {shelf.saved.map((item) => (
                      <div key={item.id} className="saved-item">
                        <Link to={`/item/${item.slug}`} className="saved-cover-link">
                          <Cover publication={item} className="saved-cover" />
                        </Link>
                        <div className="saved-body">
                          <Link to={`/item/${item.slug}`}>
                            <h3>{item.title}</h3>
                          </Link>
                          <p>
                            {item.author} · {item.category?.name}
                          </p>
                        </div>
                        <Link to={`/read/${item.slug}`} className="btn btn-outline btn-sm">
                          อ่าน
                        </Link>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeSaved(item.id)}
                          aria-label="นำออกจากรายการที่บันทึก"
                          title="นำออก"
                        >
                          <Icon name="bookmark" size={17} filled />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <Icon name="star" size={26} />
                    <h3>ยังไม่มีรายการที่บันทึก</h3>
                    <p>กดไอคอนบุ๊กมาร์กบนหน้ารายละเอียดเพื่อเก็บไว้ที่นี่</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="account-content profile-layout">
              <form className="profile-card" onSubmit={saveProfile}>
                <h2>ข้อมูลส่วนตัว</h2>
                <div className="profile-avatar-row">
                  <span className="avatar avatar-xl" style={{ background: `hsl(${user.avatarHue} 55% 42%)` }}>
                    {initials(user.name)}
                  </span>
                  <div>
                    <strong>{user.email}</strong>
                    <p>บทบาท: {roleLabels[user.role]}</p>
                  </div>
                </div>
                <label className="field">
                  <span>ชื่อ–นามสกุล</span>
                  <input
                    className="input"
                    value={profile.name}
                    onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                    required
                  />
                </label>
                <label className="field">
                  <span>หน่วยงาน / สถานศึกษา</span>
                  <input
                    className="input"
                    value={profile.affiliation}
                    onChange={(event) => setProfile({ ...profile, affiliation: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>เกี่ยวกับคุณ</span>
                  <textarea
                    className="input textarea"
                    rows={3}
                    value={profile.bio}
                    onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
                    placeholder="ความสนใจหรือบทบาทของคุณ"
                  />
                </label>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner spinner-sm" /> : <Icon name="check" size={16} />} บันทึกข้อมูล
                </button>
              </form>

              <form className="profile-card" onSubmit={saveProfile}>
                <h2>เปลี่ยนรหัสผ่าน</h2>
                <p className="muted-text">แนะนำให้เปลี่ยนรหัสผ่านทุก 6 เดือนเพื่อความปลอดภัย</p>
                <label className="field">
                  <span>รหัสผ่านปัจจุบัน</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={profile.currentPassword}
                    onChange={(event) => setProfile({ ...profile, currentPassword: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>รหัสผ่านใหม่</span>
                  <input
                    className="input"
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={profile.newPassword}
                    onChange={(event) => setProfile({ ...profile, newPassword: event.target.value })}
                    placeholder="อย่างน้อย 8 ตัวอักษร"
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-outline"
                  disabled={saving || !profile.newPassword || !profile.currentPassword}
                >
                  <Icon name="lock" size={16} /> อัปเดตรหัสผ่าน
                </button>
              </form>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
