import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Icon } from './Icons';
import { SearchBar } from './SearchBar';
import { InstallPrompt, OfflineNotice } from './Pwa';
import { initials } from '../lib/format';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <rect width="40" height="40" rx="12" fill="url(#brand-gradient)" />
          <path d="M11 12.5c3.2-1.6 6.1-1.6 9 0v16c-2.9-1.6-5.8-1.6-9 0z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M29 12.5c-3.2-1.6-6.1-1.6-9 0v16c2.9-1.6 5.8-1.6 9 0z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="20" cy="9" r="1.7" fill="white" />
          <defs>
            <linearGradient id="brand-gradient" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#14b8a6" />
              <stop offset="1" stopColor="#0f766e" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      {compact ? null : (
        <span className="brand-text">
          <strong>NAKHONMAESOT</strong>
          <small>LIBRARY</small>
        </span>
      )}
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="icon-button" onClick={toggle} aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมด">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const staff = user.role === 'admin' || user.role === 'editor';
  const displayName = user.name.replace(/^(ดร\.|ผศ\.|รศ\.|ศ\.|นางสาว|นาง|นาย)\s*/u, '').split(/\s+/)[0];
  return (
    <details className="account-menu">
      <summary aria-label="เมนูบัญชี">
        <span className="avatar" style={{ background: `hsl(${user.avatarHue} 55% 42%)` }}>
          {initials(user.name)}
        </span>
        <span className="account-name">{displayName}</span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <div className="account-dropdown">
        <div className="account-head">
          <span className="avatar avatar-lg" style={{ background: `hsl(${user.avatarHue} 55% 42%)` }}>
            {initials(user.name)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <Link to="/account">
          <Icon name="bookmark" size={16} /> ชั้นหนังสือของฉัน
        </Link>
        {staff ? (
          <Link to="/admin">
            <Icon name="chart" size={16} /> แดชบอร์ดผู้ดูแล
          </Link>
        ) : null}
        <Link to="/account?tab=profile">
          <Icon name="settings" size={16} /> ตั้งค่าโปรไฟล์
        </Link>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          <Icon name="logout" size={16} /> ออกจากระบบ
        </button>
      </div>
    </details>
  );
}

const NAV_ITEMS = [
  { to: '/', label: 'หน้าแรก', icon: 'home' as const, end: true },
  { to: '/library', label: 'คลังสารสนเทศ', icon: 'library' as const },
  { to: '/library?type=journal', label: 'วารสาร', icon: 'journal' as const },
  { to: '/library?sort=newest', label: 'มาใหม่', icon: 'sparkle' as const },
];

export function SiteHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navActive = (to: string) => {
    const [path, search] = to.split('?');
    if (location.pathname !== path) return false;
    const current = new URLSearchParams(location.search);
    if (!search) {
      return path === '/library' ? !current.get('type') && !current.get('sort') : true;
    }
    for (const [key, value] of new URLSearchParams(search)) {
      if (current.get(key) !== value) return false;
    }
    return true;
  };
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="brand-link" aria-label="Nakhonmaesot Library หน้าแรก">
          <Logo />
        </Link>
        <nav className="desktop-nav" aria-label="เมนูหลัก">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={`nav-link ${navActive(item.to) ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <div className="header-search">
            <SearchBar variant="header" />
          </div>
          <button
            type="button"
            className="icon-button mobile-search"
            aria-label="ค้นหา"
            onClick={() => navigate('/library?focus=search')}
          >
            <Icon name="search" size={19} />
          </button>
          <ThemeToggle />
          {user ? (
            <AccountMenu />
          ) : (
            <Link to="/login" className="btn btn-primary btn-sm header-login">
              เข้าสู่ระบบ
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function MobileNav() {
  const location = useLocation();
  const { user } = useAuth();
  const items = [
    { to: '/', label: 'หน้าแรก', icon: 'home' as const },
    { to: '/library', label: 'คลัง', icon: 'library' as const },
    { to: '/library?focus=search', label: 'ค้นหา', icon: 'search' as const },
    { to: '/account', label: 'ชั้นหนังสือ', icon: 'bookmark' as const },
    { to: user ? (user.role === 'reader' ? '/account?tab=profile' : '/admin') : '/login', label: user ? 'บัญชี' : 'เข้าสู่ระบบ', icon: 'user' as const },
  ];
  const params = new URLSearchParams(location.search);
  const isItemActive = (label: string) => {
    if (label === 'หน้าแรก') return location.pathname === '/';
    if (label === 'ค้นหา') return location.pathname === '/library' && params.get('focus') === 'search';
    if (label === 'คลัง') return location.pathname === '/library' && params.get('focus') !== 'search';
    if (label === 'ชั้นหนังสือ') return location.pathname === '/account' && params.get('tab') !== 'profile';
    if (label === 'บัญชี' || label === 'เข้าสู่ระบบ') {
      if (!user) return location.pathname === '/login';
      if (user.role === 'reader') return location.pathname === '/account' && params.get('tab') === 'profile';
      return location.pathname.startsWith('/admin');
    }
    return false;
  };
  return (
    <nav className="mobile-nav" aria-label="เมนูมือถือ">
      {items.map((item) => {
        const active = isItemActive(item.label);
        return (
          <Link key={item.label} to={item.to} className={`mobile-nav-item ${active ? 'active' : ''}`}>
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>
            ศูนย์รวมวารสาร งานวิจัย และหนังสืออิเล็กทรอนิกส์
            <br />
            อ่านออนไลน์ได้ทุกที่ ทุกอุปกรณ์ พร้อมระบบสืบค้นอัจฉริยะ
          </p>
          <div className="footer-social">
            <span className="chip chip-ghost">
              <Icon name="globe" size={14} /> เปิดให้บริการทุกวัน
            </span>
            <span className="chip chip-ghost">
              <Icon name="shield" size={14} /> มาตรฐานการเข้าถึง
            </span>
          </div>
        </div>
        <div className="footer-col">
          <h4>คลังสารสนเทศ</h4>
          <Link to="/library?type=journal">วารสารวิชาการ</Link>
          <Link to="/library?type=ebook">หนังสืออิเล็กทรอนิกส์</Link>
          <Link to="/library?type=research">งานวิจัย</Link>
          <Link to="/library?type=report">รายงานประจำปี</Link>
        </div>
        <div className="footer-col">
          <h4>สำหรับผู้ใช้</h4>
          <Link to="/library?sort=newest">รายการมาใหม่</Link>
          <Link to="/library?sort=popular">ยอดนิยม</Link>
          <Link to="/account">ชั้นหนังสือของฉัน</Link>
          <Link to="/register">สมัครสมาชิก</Link>
        </div>
        <div className="footer-col">
          <h4>สำหรับบุคลากร</h4>
          <Link to="/admin">แดชบอร์ดสถิติ</Link>
          <Link to="/admin/content">จัดการเนื้อหา</Link>
          <Link to="/admin/users">จัดการผู้ใช้</Link>
          <Link to="/admin/taxonomy">หมวดหมู่และแท็ก</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Nakhonmaesot Library · สงวนลิขสิทธิ์</span>
        <span>ออกแบบเพื่อการเข้าถึง · รองรับ Android และ iOS</span>
      </div>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <>
      <SiteHeader />
      <main className="site-main" key={location.pathname}>
        {children}
      </main>
      <SiteFooter />
      <MobileNav />
      <InstallPrompt />
      <OfflineNotice />
    </>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}
