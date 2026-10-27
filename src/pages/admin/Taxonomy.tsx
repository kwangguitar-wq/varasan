import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Category, Tag } from '../../lib/types';
import { AdminLayout } from '../../components/AdminLayout';
import { Icon } from '../../components/Icons';
import { useToast } from '../../lib/toast';
import { formatNumber } from '../../lib/format';

const ICON_OPTIONS = [
  { value: 'book', label: 'หนังสือ' },
  { value: 'journal', label: 'วารสาร' },
  { value: 'flask', label: 'งานวิจัย' },
  { value: 'sparkle', label: 'วัฒนธรรม' },
  { value: 'chart', label: 'รายงาน' },
  { value: 'heart', label: 'สุขภาพ' },
];

const ACCENTS = ['#0f766e', '#4338ca', '#be185d', '#b45309', '#0369a1', '#047857', '#6d28d9'];

export function AdminTaxonomy() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: '', description: '', accent: ACCENTS[0], icon: 'book' });
  const [editing, setEditing] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    api
      .get<{ categories: Category[] }>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => null);
    api
      .get<{ tags: Tag[] }>('/api/tags')
      .then((data) => setTags(data.tags))
      .catch(() => null);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/categories/${editing.id}`, { ...form, sortOrder: categories.length });
        toast.show('อัปเดตหมวดหมู่แล้ว', 'success');
      } else {
        await api.post('/api/categories', { ...form, sortOrder: categories.length + 1 });
        toast.show('เพิ่มหมวดหมู่ใหม่แล้ว', 'success');
      }
      setForm({ name: '', description: '', accent: ACCENTS[0], icon: 'book' });
      setEditing(null);
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (category: Category) => {
    setEditing(category);
    setForm({
      name: category.name,
      description: category.description ?? '',
      accent: category.accent,
      icon: category.icon,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeCategory = async (category: Category) => {
    if (!window.confirm(`ลบหมวดหมู่ “${category.name}” ใช่หรือไม่? รายการในหมวดจะยังคงอยู่แต่ไม่ถูกจัดหมวด`)) return;
    try {
      await api.delete(`/api/categories/${category.id}`);
      toast.show('ลบหมวดหมู่แล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  const removeTag = async (tag: Tag) => {
    if (!window.confirm(`ลบแท็ก “${tag.name}” ออกจากทุกรายการ?`)) return;
    try {
      await api.delete(`/api/tags/${tag.id}`);
      toast.show('ลบแท็กแล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  return (
    <AdminLayout
      title="หมวดหมู่และแท็ก"
      description="จัดระบบการค้นหาให้ผู้อ่านเข้าถึงเนื้อหาได้ตรงความต้องการ"
    >
      <div className="taxonomy-layout">
        <form className="panel" onSubmit={submit}>
          <div className="panel-head">
            <div>
              <h2>{editing ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่ใหม่'}</h2>
              <p>หมวดหมู่จะแสดงบนหน้าแรกและใช้เป็นตัวกรองหลัก</p>
            </div>
            {editing ? (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setEditing(null);
                  setForm({ name: '', description: '', accent: ACCENTS[0], icon: 'book' });
                }}
              >
                ยกเลิกการแก้ไข
              </button>
            ) : null}
          </div>
          <label className="field">
            <span>ชื่อหมวดหมู่</span>
            <input
              className="input"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="เช่น นวัตกรรมการศึกษา"
            />
          </label>
          <label className="field">
            <span>คำอธิบาย</span>
            <textarea
              className="input textarea"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="อธิบายขอบเขตของหมวดนี้สั้น ๆ"
            />
          </label>
          <div className="field">
            <span>สีประจำหมวด</span>
            <div className="swatch-list">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={form.accent === color ? 'active' : ''}
                  style={{ background: color }}
                  onClick={() => setForm({ ...form, accent: color })}
                  aria-label={`เลือกสี ${color}`}
                />
              ))}
              <input
                type="color"
                value={form.accent}
                onChange={(event) => setForm({ ...form, accent: event.target.value })}
                aria-label="เลือกสีอื่น"
              />
            </div>
          </div>
          <label className="field">
            <span>ไอคอน</span>
            <select className="input" value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
              {ICON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <Icon name={editing ? 'check' : 'plus'} size={16} />}
            {editing ? 'บันทึกการแก้ไข' : 'เพิ่มหมวดหมู่'}
          </button>
        </form>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>หมวดหมู่ทั้งหมด</h2>
              <p>{categories.length} หมวด · จำนวนรายการที่เผยแพร่แล้ว</p>
            </div>
          </div>
          <div className="category-manage-list">
            {categories.map((category) => (
              <div key={category.id} className="category-manage-item">
                <span className="category-swatch" style={{ background: category.accent }}>
                  <Icon name={category.icon === 'journal' ? 'journal' : category.icon === 'flask' ? 'flask' : category.icon === 'chart' ? 'chart' : category.icon === 'heart' ? 'heart' : category.icon === 'sparkle' ? 'sparkle' : 'library'} size={18} />
                </span>
                <div>
                  <strong>{category.name}</strong>
                  <p>{category.description ?? 'ไม่มีคำอธิบาย'}</p>
                </div>
                <span className="category-manage-count">{formatNumber(category.count ?? 0)}</span>
                <div className="table-actions">
                  <button type="button" className="icon-button" onClick={() => startEdit(category)} aria-label="แก้ไข">
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-button danger" onClick={() => removeCategory(category)} aria-label="ลบ">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>แท็กทั้งหมด</h2>
            <p>แท็กถูกสร้างอัตโนมัติเมื่อเพิ่มหรือแก้ไขรายการ · {tags.length} แท็ก</p>
          </div>
        </div>
        <div className="tag-manage-grid">
          {tags.map((tag) => (
            <span key={tag.id} className="tag-manage-item">
              <Icon name="tag" size={13} />
              {tag.name}
              <em>{formatNumber(tag.count ?? 0)}</em>
              <button type="button" onClick={() => removeTag(tag)} aria-label={`ลบแท็ก ${tag.name}`}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {!tags.length ? <p className="hint">ยังไม่มีแท็กในระบบ</p> : null}
        </div>
      </section>
    </AdminLayout>
  );
}
