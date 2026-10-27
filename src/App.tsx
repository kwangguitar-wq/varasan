import { useEffect } from 'react';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { PageShell } from './components/Shell';
import { RequireAuth, RequireStaff } from './components/Guards';
import { Home } from './pages/Home';
import { Library } from './pages/Library';
import { ItemDetail } from './pages/ItemDetail';
import { Reader } from './pages/Reader';
import { AuthPage } from './pages/Auth';
import { Account } from './pages/Account';
import { AdminDashboard } from './pages/admin/Dashboard';
import { AdminContent } from './pages/admin/Content';
import { AdminEditor } from './pages/admin/Editor';
import { AdminUsers } from './pages/admin/Users';
import { AdminTaxonomy } from './pages/admin/Taxonomy';
import { Icon } from './components/Icons';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function SiteLayout() {
  return (
    <PageShell>
      <Outlet />
    </PageShell>
  );
}

function NotFound() {
  return (
    <div className="section-inner page-pad">
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="search" size={30} />
        </span>
        <h1>ไม่พบหน้าที่คุณต้องการ</h1>
        <p>ลิงก์อาจถูกเปลี่ยนหรือหน้านี้ถูกย้ายไปแล้ว</p>
        <div className="empty-actions">
          <Link to="/" className="btn btn-primary">
            กลับหน้าแรก
          </Link>
          <Link to="/library" className="btn btn-outline">
            ไปที่คลังสารสนเทศ
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/item/:slug" element={<ItemDetail />} />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <Account />
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/read/:slug" element={<Reader />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route
          path="/admin"
          element={
            <RequireStaff>
              <AdminDashboard />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/content"
          element={
            <RequireStaff>
              <AdminContent />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/content/new"
          element={
            <RequireStaff>
              <AdminEditor />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/content/:id/edit"
          element={
            <RequireStaff>
              <AdminEditor />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireStaff>
              <AdminUsers />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/taxonomy"
          element={
            <RequireStaff>
              <AdminTaxonomy />
            </RequireStaff>
          }
        />
      </Routes>
    </>
  );
}
