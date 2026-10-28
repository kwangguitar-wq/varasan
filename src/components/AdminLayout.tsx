import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon } from './Icons';
import type { IconName } from './Icons';
import { Logo } from './Shell';
import { initials, roleLabels } from '../lib/format';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/admin', label: 'แดชบอร์ดสถิติ', icon: 'chart', end: true },
  { to: '/admin/content', label: 'จัดการเนื้อหา', icon: 'library' },
  { to: '/admin/users', label: 'ผู้ใช้และสิทธิ์', icon: 'users' },
  { to: '/admin/taxonomy', label: 'หมวดหมู่และแท็ก', icon: 'tag' },
];

export function AdminLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin" className="admin-brand">
          <Logo />
        </Link>
        <nav className="admin-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <Link to="/" className="admin-nav-link">
            <Icon name="arrowLeft" size={18} />
            <span>กลับสู่หน้าหลัก</span>
          </Link>
          <div className="admin-user">
            <span className="avatar" style={{ background: `hsl(${user.avatarHue} 55% 42%)` }}>
              {initials(user.name)}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="ออกจากระบบ"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-header">
          <div>
            <span className="eyebrow">Nakhonmaesot Console</span>
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="admin-header-actions">{actions}</div>
        </header>
        <div className="admin-mobile-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-mobile-link ${isActive ? 'active' : ''}`}
            >
              <Icon name={item.icon} size={16} /> {item.label}
            </NavLink>
          ))}
        </div>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
