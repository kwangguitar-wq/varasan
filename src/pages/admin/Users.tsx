import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Role } from '../../lib/types';
import { AdminLayout } from '../../components/AdminLayout';
import { Icon } from '../../components/Icons';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { formatDate, formatNumber, initials, roleLabels } from '../../lib/format';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  affiliation: string | null;
  avatar_hue: number;
  status: 'active' | 'suspended';
  created_at: string;
  publication_count: number;
  read_count: number;
}

const ROLE_OPTIONS: Role[] = ['admin', 'editor', 'reader'];

export function AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roleCounts, setRoleCounts] = useState<{ role: Role; count: number }[]>([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'reader' as Role, affiliation: '' });
  const [saving, setSaving] = useState(false);
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const load = () => {
    api
      .get<{ users: UserRow[]; roleCounts: { role: Role; count: number }[] }>(`/api/users?q=${encodeURIComponent(search)}`)
      .then((data) => {
        setUsers(data.users);
        setRoleCounts(data.roleCounts);
      })
      .catch((err: Error) => toast.show(err.message, 'error'));
  };

  useEffect(() => {
    const timer = window.setTimeout(load, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const changeRole = async (row: UserRow, role: Role) => {
    try {
      await api.patch(`/api/users/${row.id}`, { role });
      toast.show(`เปลี่ยนสิทธิ์ของ ${row.name} เป็น ${roleLabels[role]} แล้ว`, 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  const toggleStatus = async (row: UserRow) => {
    try {
      await api.patch(`/api/users/${row.id}`, { status: row.status === 'active' ? 'suspended' : 'active' });
      toast.show(row.status === 'active' ? 'ระงับบัญชีแล้ว' : 'เปิดใช้งานบัญชีแล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  const remove = async (row: UserRow) => {
    if (!window.confirm(`ต้องการลบบัญชี ${row.name} ใช่หรือไม่?`)) return;
    try {
      await api.delete(`/api/users/${row.id}`);
      toast.show('ลบบัญชีแล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/users', form);
      toast.show('เพิ่มผู้ใช้ใหม่แล้ว', 'success');
      setShowForm(false);
      setForm({ name: '', email: '', password: '', role: 'reader', affiliation: '' });
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const countFor = (role: Role) => roleCounts.find((entry) => entry.role === role)?.count ?? 0;

  return (
    <AdminLayout
      title="ผู้ใช้และสิทธิ์การเข้าถึง"
      description="กำหนดบทบาทผู้ดูแลระบบ ผู้เขียน/บรรณาธิการ และผู้อ่าน"
      actions={
        <button type="button" className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>
          <Icon name={showForm ? 'close' : 'plus'} size={17} /> {showForm ? 'ปิดแบบฟอร์ม' : 'เพิ่มผู้ใช้'}
        </button>
      }
    >
      <div className="role-cards">
        {ROLE_OPTIONS.map((role) => (
          <div key={role} className={`role-card role-${role}`}>
            <span className="role-icon">
              <Icon name={role === 'admin' ? 'shield' : role === 'editor' ? 'edit' : 'user'} size={20} />
            </span>
            <div>
              <strong>{roleLabels[role]}</strong>
              <span>{formatNumber(countFor(role))} บัญชี</span>
            </div>
          </div>
        ))}
        <div className="role-card role-total">
          <span className="role-icon">
            <Icon name="users" size={20} />
          </span>
          <div>
            <strong>ผู้ใช้ทั้งหมด</strong>
            <span>{formatNumber(users.length)} บัญชี</span>
          </div>
        </div>
      </div>

      {showForm ? (
        <form className="panel add-user-form" onSubmit={createUser}>
          <div className="panel-head">
            <div>
              <h2>เพิ่มผู้ใช้ใหม่</h2>
              <p>สร้างบัญชีและกำหนดสิทธิ์เริ่มต้น</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>ชื่อ–นามสกุล</span>
              <input
                className="input"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>อีเมล</span>
              <input
                className="input"
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>
            <label className="field">
              <span>รหัสผ่านเริ่มต้น</span>
              <input
                className="input"
                required
                minLength={8}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                placeholder="อย่างน้อย 8 ตัวอักษร"
              />
            </label>
            <label className="field">
              <span>สิทธิ์การใช้งาน</span>
              <select
                className="input"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-full">
              <span>หน่วยงาน</span>
              <input
                className="input"
                value={form.affiliation}
                onChange={(event) => setForm({ ...form, affiliation: event.target.value })}
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <Icon name="check" size={16} />} สร้างบัญชี
          </button>
        </form>
      ) : null}

      <div className="admin-toolbar">
        <div className="admin-search">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="ค้นหาชื่อ อีเมล หรือหน่วยงาน…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <span className="admin-count">{formatNumber(users.length)} บัญชี</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ผู้ใช้</th>
              <th>หน่วยงาน</th>
              <th>สิทธิ์</th>
              <th className="num">ผลงาน</th>
              <th className="num">เข้าอ่าน</th>
              <th>สถานะ</th>
              <th>สมัครเมื่อ</th>
              <th aria-label="การจัดการ" />
            </tr>
          </thead>
          <tbody>
            {users.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="table-title-cell">
                    <span className="avatar" style={{ background: `hsl(${row.avatar_hue} 55% 42%)` }}>
                      {initials(row.name)}
                    </span>
                    <div>
                      <strong className="table-title">{row.name}</strong>
                      <span className="table-sub">{row.email}</span>
                    </div>
                  </div>
                </td>
                <td className="table-muted">{row.affiliation ?? '—'}</td>
                <td>
                  <select
                    className="input input-sm"
                    value={row.role}
                    disabled={row.id === currentUser?.id}
                    onChange={(event) => changeRole(row, event.target.value as Role)}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">{formatNumber(row.publication_count)}</td>
                <td className="num">{formatNumber(row.read_count)}</td>
                <td>
                  <button
                    type="button"
                    className={`status-chip status-${row.status === 'active' ? 'published' : 'draft'}`}
                    onClick={() => toggleStatus(row)}
                    disabled={row.id === currentUser?.id}
                  >
                    {row.status === 'active' ? 'ใช้งาน' : 'ถูกระงับ'}
                  </button>
                </td>
                <td className="table-date">{formatDate(row.created_at)}</td>
                <td>
                  <div className="table-actions">
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => remove(row)}
                      disabled={row.id === currentUser?.id}
                      aria-label="ลบผู้ใช้"
                      title="ลบผู้ใช้"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}
