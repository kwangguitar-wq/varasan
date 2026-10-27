import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  counts: { reading: number; saved: number; authored: number } | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { name: string; email: string; password: string; affiliation?: string }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (input: Record<string, unknown>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState<AuthContextValue['counts']>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User; counts: AuthContextValue['counts'] }>('/api/auth/me');
      setUser(data.user);
      setCounts(data.counts);
    } catch {
      setUser(null);
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: User }>('/api/auth/login', { email, password });
    setUser(data.user);
    void refresh();
    return data.user;
  }, [refresh]);

  const register = useCallback(
    async (input: { name: string; email: string; password: string; affiliation?: string }) => {
      const data = await api.post<{ user: User }>('/api/auth/register', input);
      setUser(data.user);
      void refresh();
      return data.user;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
    setCounts(null);
  }, []);

  const updateProfile = useCallback(
    async (input: Record<string, unknown>) => {
      await api.patch('/api/auth/me', input);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(
    () => ({ user, counts, loading, login, register, logout, refresh, updateProfile }),
    [user, counts, loading, login, register, logout, refresh, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
