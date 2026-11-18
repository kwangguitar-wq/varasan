import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Category, Publication, Tag } from '../../lib/types';
import { AdminLayout } from '../../components/AdminLayout';
import { Icon } from '../../components/Icons';
import { useToast } from '../../lib/toast';
import { formatFileSize, typeLabels } from '../../lib/format';
import { uploadInChunks, type UploadConfig } from '../../lib/upload';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { unzipSync } from 'fflate';
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
const DRAFT_KEY = 'varasan-admin-editor-draft-v1';
const PENDING_PUBLICATION_KEY = 'varasan-admin-pending-publication-v1';
async function firstPageCover(file: File): Promise<File | null> {
  try {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1.5, 900 / base.width) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d'); if (!context) return null;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
        return blob ? new File([blob], 'auto-cover.jpg', { type: 'image/jpeg' }) : null;
      } finally { await doc.destroy(); }
    }
    if (/\.zip$/i.test(file.name)) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const path = Object.keys(archive).filter((name) => /\.(jpe?g|png|webp)$/i.test(name)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }))[0];
      if (!path) return null;
      const type = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
      return new File([archive[path]], 'auto-cover.' + path.split('.').pop(), { type });
    }
  } catch { return null; }
  return null;
}

const EMPTY_FORM = {
  title: '',
  subtitle: '',
  author: '',
  publisher: '',
  year: String(new Date().getFullYear() + 543),
  type: 'ebook',
  categoryId: '',
  language: 'th',
  issn: '',
  isbn: '',
  pages: '',
  description: '',
  abstract: '',
  status: 'draft',
  featured: false,
};

export function AdminEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tagLibrary, setTagLibrary] = useState<Tag[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [existing, setExisting] = useState<Publication | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadConfig, setUploadConfig] = useState<UploadConfig | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [autoCover, setAutoCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ categories: Category[] }>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => null);
    api.get<{ tags: Tag[] }>('/api/tags').then((data) => setTagLibrary(data.tags)).catch(() => null);
    api.get<UploadConfig>('/api/uploads/config').then(setUploadConfig).catch(() => null);
  }, []);

  useEffect(() => {
    if (!id) {
      try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (saved?.form) setForm({ ...EMPTY_FORM, ...saved.form }); if (Array.isArray(saved?.tags)) setTags(saved.tags); } catch { /* ignore invalid draft */ }
      setExisting(null); setDraftReady(true); return;
    }
    api
      .get<{ publication: Publication }>(`/api/publications/${id}`)
      .then(({ publication }) => {
        setExisting(publication);
        setDraftReady(true);
        setTags((publication.tags ?? []).map((tag) => tag.name));
        setCoverPreview(publication.coverUrl);
        setForm({
          title: publication.title,
          subtitle: publication.subtitle ?? '',
          author: publication.author ?? '',
          publisher: publication.publisher ?? '',
          year: publication.year ? String(publication.year) : '',
          type: publication.type,
          categoryId: publication.category ? String(publication.category.id) : '',
          language: publication.language,
          issn: publication.issn ?? '',
          isbn: publication.isbn ?? '',
          pages: String(publication.pages || ''),
          description: publication.description ?? '',
          abstract: publication.abstract ?? '',
          status: publication.status,
          featured: publication.featured,
        });
      })
      .catch((err: Error) => toast.show(err.message, 'error'));
  }, [id, toast]);

  useEffect(() => {
    if (!draftReady || editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, tags })); } catch { /* storage unavailable */ }
  }, [draftReady, editing, form, tags]);

  const addTag = (value: string) => {
    const clean = value.trim().replace(/,$/, '');
    if (!clean) return;
    if (!tags.includes(clean) && tags.length < 20) setTags([...tags, clean]);
    setTagInput('');
  };

  const onCoverChange = (selected: File | null) => {
    setCover(selected); setAutoCover(false);
    if (selected) setCoverPreview(URL.createObjectURL(selected));
    else if (file) void firstPageCover(file).then((generated) => { if (generated) { setCover(generated); setCoverPreview(URL.createObjectURL(generated)); setAutoCover(true); } });
    else setCoverPreview(existing?.coverUrl ?? null);
  };
  const onBookFileChange = async (selected: File | null) => {
    setFile(selected);
    if (!selected || cover && !autoCover) return;
    const generated = await firstPageCover(selected);
    if (generated) { setCover(generated); setCoverPreview(URL.createObjectURL(generated)); setAutoCover(true); }
    else if (!existing?.coverUrl) { setCover(null); setCoverPreview(null); setAutoCover(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.show('กรุณาระบุชื่อเรื่อง', 'error');
      return;
    }
    if (form.status === 'published' && !file && !existing?.fileUrl) {
      toast.show('การเผยแพร่ต้องมีไฟล์ PDF, ePub หรือ Flipbook', 'error');
      return;
    }
    if (file && uploadConfig && file.size > uploadConfig.maxFileBytes) {
      toast.show(`ไฟล์ใหญ่เกินกำหนด (สูงสุด ${formatFileSize(uploadConfig.maxFileBytes)})`, 'error');
      return;
    }
    setSaving(true);
    setProgress(null);
    try {
      if (uploadConfig?.mode === 'chunked') await saveChunked();
      else await saveMultipart();
      toast.show(editing ? 'บันทึกการแก้ไขและจัดทำดัชนีใหม่แล้ว' : 'เพิ่มรายการและจัดทำดัชนีคำสำคัญแล้ว', 'success');
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      navigate('/admin/content');
    } catch (error) {
      toast.show((error as Error).message, 'error');
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const saveMultipart = async () => {
    const payload = new FormData();
    for (const [key, value] of Object.entries(form)) {
      payload.append(key, String(value));
    }
    payload.append('tags', JSON.stringify(tags));
    if (file) payload.append('file', file);
    if (cover) payload.append('cover', cover);
    if (editing) await api.patch(`/api/publications/${id}`, payload);
    else await api.post('/api/publications', payload);
  };

  // Hosts that cap a request body (Vercel: 4.5 MB) save the record first, send
  // the book in chunks, then publish — so nothing is lost when the file is big.
  const saveChunked = async () => {
    const metadata = {
      title: form.title,
      subtitle: form.subtitle,
      author: form.author,
      publisher: form.publisher,
      year: form.year,
      type: form.type,
      categoryId: form.categoryId,
      language: form.language,
      issn: form.issn,
      isbn: form.isbn,
      pages: form.pages,
      description: form.description,
      abstract: form.abstract,
      featured: form.featured,
      tags: JSON.stringify(tags),
    };
    let targetId = Number(id);
    if (editing) {
      await api.patch(`/api/publications/${targetId}`, metadata);
    } else {
      // If a previous upload failed after creating its D1 row, resume that
      // publication instead of creating a duplicate on the next Save click.
      const pendingId = Number(localStorage.getItem(PENDING_PUBLICATION_KEY));
      if (Number.isInteger(pendingId) && pendingId > 0) {
        try {
          await api.get(`/api/publications/${pendingId}`);
          targetId = pendingId;
          await api.patch(`/api/publications/${targetId}`, metadata);
        } catch {
          localStorage.removeItem(PENDING_PUBLICATION_KEY);
          targetId = 0;
        }
      }
      if (!targetId) {
        const created = await api.post<{ publication: Publication }>('/api/publications', {
          ...metadata,
          status: 'draft',
        });
        targetId = created.publication.id;
        localStorage.setItem(PENDING_PUBLICATION_KEY, String(targetId));
      }
    }
    if (file) await uploadInChunks(targetId, 'file', file, setProgress);
    if (cover) await uploadInChunks(targetId, 'cover', cover);
    await api.patch(`/api/publications/${targetId}`, { status: form.status });
    if (!editing) localStorage.removeItem(PENDING_PUBLICATION_KEY);
  };

  const suggestions = tagLibrary.filter(
    (tag) => !tags.includes(tag.name) && (!tagInput || tag.name.toLowerCase().includes(tagInput.toLowerCase())),
  );

  return (
    <AdminLayout
      title={editing ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}
      description="ระบบจะดึงคำสำคัญจากเนื้อหาและสร้างปกอัตโนมัติให้ หากยังไม่แนบรูปปก"
      actions={
        <div className="editor-actions">
          <Link to="/admin/content" className="btn btn-ghost">
            ยกเลิก
          </Link>
          <button type="submit" form="publication-form" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <Icon name="check" size={17} />}
            {saving
              ? progress !== null
                ? `กำลังอัปโหลด ${progress}%`
                : 'กำลังบันทึกและจัดทำดัชนี…'
              : 'บันทึกรายการ'}
          </button>
        </div>
      }
    >
      <form id="publication-form" className="editor-layout" onSubmit={submit}>
        <div className="editor-main">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>ข้อมูลบรรณานุกรม</h2>
                <p>ข้อมูลเหล่านี้ใช้สำหรับการสืบค้นขั้นสูง</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-full">
                <span>ชื่อเรื่อง *</span>
                <input
                  className="input"
                  required
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="เช่น วารสารมนุษยศาสตร์ ปีที่ 12 ฉบับที่ 2"
                />
              </label>
              <label className="field field-full">
                <span>ชื่อรอง / Subtitle</span>
                <input
                  className="input"
                  value={form.subtitle}
                  onChange={(event) => setForm({ ...form, subtitle: event.target.value })}
                  placeholder="Reading Cultures in a Digital Age"
                />
              </label>
              <label className="field">
                <span>ผู้แต่ง / กองบรรณาธิการ</span>
                <input
                  className="input"
                  value={form.author}
                  onChange={(event) => setForm({ ...form, author: event.target.value })}
                  placeholder="ชื่อผู้แต่งหรือหน่วยงาน"
                />
              </label>
              <label className="field">
                <span>สำนักพิมพ์</span>
                <input
                  className="input"
                  value={form.publisher}
                  onChange={(event) => setForm({ ...form, publisher: event.target.value })}
                  placeholder="สำนักพิมพ์มหาวิทยาลัยศิลปากร"
                />
              </label>
              <label className="field">
                <span>ปีที่พิมพ์ (พ.ศ.)</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.year}
                  onChange={(event) => setForm({ ...form, year: event.target.value })}
                />
              </label>
              <label className="field">
                <span>ประเภท</span>
                <select className="input" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>หมวดหมู่</span>
                <select
                  className="input"
                  value={form.categoryId}
                  onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                >
                  <option value="">ไม่ระบุหมวดหมู่</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>ภาษา</span>
                <select className="input" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
                  <option value="th">ไทย</option>
                  <option value="en">อังกฤษ</option>
                </select>
              </label>
              <label className="field">
                <span>ISSN</span>
                <input
                  className="input"
                  value={form.issn}
                  onChange={(event) => setForm({ ...form, issn: event.target.value })}
                  placeholder="2586-8414"
                />
              </label>
              <label className="field">
                <span>ISBN</span>
                <input
                  className="input"
                  value={form.isbn}
                  onChange={(event) => setForm({ ...form, isbn: event.target.value })}
                  placeholder="978-616-123-456-7"
                />
              </label>
              <label className="field">
                <span>จำนวนหน้า (ระบบตรวจอัตโนมัติเมื่อมีไฟล์)</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.pages}
                  onChange={(event) => setForm({ ...form, pages: event.target.value })}
                  placeholder="0"
                />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>เนื้อหาและบทคัดย่อ</h2>
                <p>ข้อความเหล่านี้จะถูกนำไปจัดทำดัชนีคำสำคัญร่วมกับเนื้อหาในไฟล์</p>
              </div>
            </div>
            <label className="field">
              <span>คำอธิบายย่อ</span>
              <textarea
                className="input textarea"
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="สรุปรายการสั้น ๆ สำหรับแสดงบนการ์ดและผลการค้นหา"
              />
            </label>
            <label className="field">
              <span>บทคัดย่อ</span>
              <textarea
                className="input textarea"
                rows={7}
                value={form.abstract}
                onChange={(event) => setForm({ ...form, abstract: event.target.value })}
                placeholder="บทคัดย่อหรือคำนำของเอกสาร"
              />
            </label>
            <div className="field">
              <span>แท็ก (กด Enter เพื่อเพิ่ม)</span>
              <div className={`tag-input ${tags.length ? 'has-tags' : ''}`}>
                {tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button type="button" onClick={() => setTags(tags.filter((value) => value !== tag))} aria-label={`ลบแท็ก ${tag}`}>
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault();
                      addTag(tagInput);
                    }
                    if (event.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
                  }}
                  onBlur={() => addTag(tagInput)}
                  placeholder={tags.length ? 'เพิ่มแท็ก…' : 'เช่น มนุษยศาสตร์, วัฒนธรรมการอ่าน'}
                />
              </div>
              {suggestions.length ? (
                <div className="tag-suggestions">
                  {suggestions.slice(0, 8).map((tag) => (
                    <button key={tag.id} type="button" className="chip chip-ghost" onClick={() => addTag(tag.name)}>
                      <Icon name="plus" size={12} /> {tag.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>ไฟล์เอกสาร</h2>
                <p>
                  รองรับ PDF, ePub และ ZIP ของรูปภาพสำหรับ Flipbook (สูงสุด{' '}
                  {formatFileSize(uploadConfig?.maxFileBytes ?? 300 * 1024 * 1024)})
                </p>
              </div>
            </div>
            <div
              className={`dropzone ${dragging ? 'dragging' : ''} ${file || existing?.fileUrl ? 'has-file' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) void onBookFileChange(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.epub,.zip"
                hidden
                onChange={(event) => void onBookFileChange(event.target.files?.[0] ?? null)}
              />
              <span className="dropzone-icon">
                <Icon name={file ? 'file' : 'upload'} size={26} />
              </span>
              {file ? (
                <div>
                  <strong>{file.name}</strong>
                  <p>{formatFileSize(file.size)} · พร้อมอัปโหลดเมื่อบันทึก</p>
                  <button
                    type="button"
                    className="link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFile(null);
                      if (autoCover && !existing?.coverUrl) { setCover(null); setCoverPreview(null); setAutoCover(false); }
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    เลือกไฟล์อื่น
                  </button>
                </div>
              ) : existing?.fileUrl ? (
                <div>
                  <strong>ไฟล์ปัจจุบัน: {existing.fileType?.toUpperCase()}</strong>
                  <p>
                    {formatFileSize(existing.fileSize)} · {existing.pages} หน้า
                  </p>
                  <span className="link-button">คลิกเพื่อแทนที่ไฟล์</span>
                </div>
              ) : (
                <div>
                  <strong>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</strong>
                  <p>PDF · ePub · ZIP (รูปภาพเรียงตามชื่อไฟล์)</p>
                </div>
              )}
            </div>
            <div className="upload-hints">
              <span>
                <Icon name="sparkle" size={14} /> ระบบดึงข้อความและคำสำคัญอัตโนมัติ
              </span>
              <span>
                <Icon name="check" size={14} /> ZIP จะถูกแปลงเป็น Flipbook พลิกหน้า
              </span>
            </div>
          </section>
        </div>

        <aside className="editor-aside">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>การเผยแพร่</h2>
              </div>
            </div>
            <div className="status-options">
              <label className={form.status === 'published' ? 'active' : ''}>
                <input
                  type="radio"
                  name="status"
                  value="published"
                  checked={form.status === 'published'}
                  onChange={() => setForm({ ...form, status: 'published' })}
                />
                <span>
                  <strong>เผยแพร่ทันที</strong>
                  <small>ผู้อ่านทั่วไปเข้าถึงได้</small>
                </span>
              </label>
              <label className={form.status === 'draft' ? 'active' : ''}>
                <input
                  type="radio"
                  name="status"
                  value="draft"
                  checked={form.status === 'draft'}
                  onChange={() => setForm({ ...form, status: 'draft' })}
                />
                <span>
                  <strong>บันทึกเป็นฉบับร่าง</strong>
                  <small>เห็นเฉพาะบุคลากร</small>
                </span>
              </label>
            </div>
            <label className="switch-row">
              <span>
                <strong>แนะนำบนหน้าแรก</strong>
                <small>แสดงในส่วนคัดสรรโดยบรรณารักษ์</small>
              </span>
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => setForm({ ...form, featured: event.target.checked })}
              />
              <i aria-hidden="true" />
            </label>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>รูปปก</h2>
              </div>
            </div>
            <div className="cover-editor">
              <div className="cover-preview">
                {coverPreview ? <img src={coverPreview} alt="ตัวอย่างปก" /> : <Icon name="library" size={30} />}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                hidden
                onChange={(event) => onCoverChange(event.target.files?.[0] ?? null)}
              />
              <button type="button" className="btn btn-outline btn-sm btn-block" onClick={() => coverInputRef.current?.click()}>
                <Icon name="upload" size={15} /> อัปโหลดรูปปก
              </button>
              <p className="hint">{autoCover ? 'สร้างปกจากหน้าแรกของไฟล์อัตโนมัติแล้ว' : 'หากไม่แนบรูปปก ระบบใช้หน้าแรกของ PDF หรือภาพแรกใน ZIP เป็นปก'} · อัตราส่วนแนะนำ 2:3</p>
            </div>
          </section>

          {existing ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>ดัชนีคำสำคัญ</h2>
                  <p>อัปเดตล่าสุด {existing.updatedAt.slice(0, 10)}</p>
                </div>
              </div>
              <div className="keyword-cloud compact">
                {(existing.keywords ?? []).slice(0, 12).map((keyword) => (
                  <span key={keyword.term} className="keyword-pill">
                    {keyword.term}
                    <em>{keyword.count}</em>
                  </span>
                ))}
                {!existing.keywords?.length ? <p className="hint">ยังไม่มีคำสำคัญ — บันทึกอีกครั้งเพื่อจัดทำดัชนี</p> : null}
              </div>
              <div className="index-meta">
                <span>
                  <Icon name="clock" size={14} /> อ่านประมาณ {existing.readingMinutes} นาที
                </span>
                <span>
                  <Icon name="file" size={14} /> {existing.pages} หน้า
                </span>
              </div>
            </section>
          ) : null}
        </aside>
      </form>
    </AdminLayout>
  );
}
