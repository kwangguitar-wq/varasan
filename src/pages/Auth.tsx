import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Icon } from '../components/Icons';
import { Logo } from '../components/Shell';

const DEMO_ACCOUNTS = [
  { role: 'ผู้ดูแลระบบ', email: 'admin@lumen.app', password: 'Lumen@2026', icon: 'shield' as const },
  { role: 'บรรณาธิการ', email: 'editor@lumen.app', password: 'Lumen@2026', icon: 'edit' as const },
  { role: 'ผู้อ่าน', email: 'reader@lumen.app', password: 'Lumen@2026', icon: 'user' as const },
];

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm: '',
    affiliation: '',
  });

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'register') {
      if (form.password !== form.confirm) {
        setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
      }
      if (form.password.length < 8) {
        setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
        toast.show('เข้าสู่ระบบสำเร็จ ยินดีต้อนรับกลับ', 'success');
      } else {
        await register({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          affiliation: form.affiliation.trim(),
        });
        toast.show('สมัครสมาชิกสำเร็จ เริ่มสำรวจคลังได้เลย', 'success');
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (email: string, password: string) => {
    setForm({ ...form, email, password, confirm: password });
    setError(null);
  };

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <Link to="/" className="auth-brand">
          <Logo />
        </Link>
        <div className="auth-panel-body">
          <span className="auth-quote-mark">“</span>
          <h2>ความรู้ไม่ควรถูกจำกัดด้วยเวลาและสถานที่</h2>
          <p>
            Lumen Library รวมวารสาร งานวิจัย และหนังสืออิเล็กทรอนิกส์ไว้ในที่เดียว
            พร้อมเครื่องมือสืบค้นที่ออกแบบมาเพื่อคนไทย
          </p>
          <div className="auth-panel-stats">
            <div>
              <strong>12,000+</strong>
              <span>บทความที่จัดทำดัชนี</span>
            </div>
            <div>
              <strong>ทุกอุปกรณ์</strong>
              <span>Android · iOS · Desktop</span>
            </div>
          </div>
          <div className="auth-panel-cards" aria-hidden="true">
            <span className="auth-mini-card auth-mini-1" />
            <span className="auth-mini-card auth-mini-2" />
            <span className="auth-mini-card auth-mini-3" />
          </div>
        </div>
        <p className="auth-panel-footer">© {new Date().getFullYear()} Lumen Library · เพื่อการเรียนรู้ตลอดชีวิต</p>
      </div>

      <div className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <span className="eyebrow">{mode === 'login' ? 'ยินดีต้อนรับกลับ' : 'เริ่มต้นใช้งาน'}</span>
            <h1>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิกฟรี'}</h1>
            <p>
              {mode === 'login'
                ? 'เข้าสู่ระบบเพื่อบันทึกความคืบหน้าการอ่านและดาวน์โหลดเอกสาร'
                : 'สร้างบัญชีผู้อ่านเพื่อเก็บชั้นหนังสือส่วนตัวและติดตามการอ่านของคุณ'}
            </p>
          </div>

          {error ? (
            <div className="alert alert-error">
              <Icon name="warning" size={17} /> {error}
            </div>
          ) : null}

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' ? (
              <>
                <label className="field">
                  <span>ชื่อ–นามสกุล</span>
                  <input
                    className="input"
                    required
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="เช่น ธนกฤต ใจดี"
                    autoComplete="name"
                  />
                </label>
                <label className="field">
                  <span>หน่วยงาน / สถานศึกษา (ไม่บังคับ)</span>
                  <input
                    className="input"
                    value={form.affiliation}
                    onChange={(event) => setForm({ ...form, affiliation: event.target.value })}
                    placeholder="เช่น มหาวิทยาลัยศิลปากร"
                    autoComplete="organization"
                  />
                </label>
              </>
            ) : null}

            <label className="field">
              <span>อีเมล</span>
              <input
                className="input"
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            <label className="field">
              <span>รหัสผ่าน</span>
              <div className="password-field">
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder={mode === 'register' ? 'อย่างน้อย 8 ตัวอักษร' : 'รหัสผ่านของคุณ'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                >
                  <Icon name={showPassword ? 'eye' : 'lock'} size={17} />
                </button>
              </div>
            </label>

            {mode === 'register' ? (
              <label className="field">
                <span>ยืนยันรหัสผ่าน</span>
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                  placeholder="กรอกรหัสผ่านอีกครั้ง"
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
              {loading ? <span className="spinner spinner-sm" /> : null}
              {mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}
            </button>
          </form>

          {mode === 'login' ? (
            <div className="demo-accounts">
              <p className="demo-title">
                <Icon name="info" size={15} /> บัญชีทดลองใช้งาน
              </p>
              <div className="demo-grid">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="demo-card"
                    onClick={() => fillDemo(account.email, account.password)}
                  >
                    <Icon name={account.icon} size={16} />
                    <span>
                      <strong>{account.role}</strong>
                      <small>{account.email}</small>
                    </span>
                  </button>
                ))}
              </div>
              <small className="demo-hint">เลือกบัญชีเพื่อเติมข้อมูลอัตโนมัติ · รหัสผ่าน Lumen@2026</small>
            </div>
          ) : null}

          <p className="auth-switch">
            {mode === 'login' ? (
              <>
                ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิกฟรี</Link>
              </>
            ) : (
              <>
                มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
              </>
            )}
          </p>
          <Link to="/" className="auth-back">
            <Icon name="arrowLeft" size={15} /> กลับไปหน้าแรก
          </Link>
        </div>
      </div>
    </div>
  );
}
