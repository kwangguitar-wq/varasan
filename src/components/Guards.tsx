import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page-loading">
        <span className="spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.role === 'reader') {
    return (
      <div className="empty-state page-pad">
        <h2>เฉพาะบุคลากรเท่านั้น</h2>
        <p>หน้านี้เปิดให้ผู้เขียน/บรรณาธิการและผู้ดูแลระบบเข้าถึง</p>
      </div>
    );
  }
  return <>{children}</>;
}
