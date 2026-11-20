import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryString } from '../../lib/api';
import type { Category, Publication, SearchResult } from '../../lib/types';
import { AdminLayout } from '../../components/AdminLayout';
import { Cover } from '../../components/PublicationCard';
import { Icon } from '../../components/Icons';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { formatDate, formatFileSize, formatNumber, typeLabels } from '../../lib/format';

export function AdminContent() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const { user } = useAuth();
  const toast = useToast();
  const status = params.get('status') ?? 'all';
  const type = params.get('type') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? '1');

  useEffect(() => {
    api
      .get<{ categories: Category[] }>('/api/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (search.trim()) next.set('q', search.trim());
        else next.delete('q');
        next.delete('page');
        return next;
      }, { replace: true });
    }, 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = queryString({
    q: params.get('q'),
    status,
    type,
    category,
    page,
    limit: 20,
    sort: 'newest',
  });

  const load = () => {
    setLoading(true);
    api
      .get<SearchResult>(`/api/publications${query}`)
      .then(setResult)
      .catch((err: Error) => toast.show(err.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const update = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  };

  const changePage = (nextPage: number) => {
    const lastPage = result?.pages ?? 1;
    const safePage = Math.min(Math.max(1, nextPage), lastPage);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (safePage <= 1) next.delete('page');
      else next.set('page', String(safePage));
      return next;
    });
  };

  const owned = (item: Publication) => user?.role === 'admin' || item.createdBy === user?.id;

  const togglePublish = async (item: Publication) => {
    const nextStatus = item.status === 'published' ? 'draft' : 'published';
    if (nextStatus === 'published' && !item.fileUrl) {
      toast.show('กรุณาอัปโหลดไฟล์ก่อนเผยแพร่', 'error');
      return;
    }
    try {
      await api.patch(`/api/publications/${item.id}`, { status: nextStatus });
      toast.show(nextStatus === 'published' ? 'เผยแพร่รายการแล้ว' : 'ย้ายกลับเป็นฉบับร่างแล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  const remove = async (item: Publication) => {
    if (!window.confirm(`ต้องการลบ “${item.title}” ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`)) return;
    try {
      await api.delete(`/api/publications/${item.id}`);
      toast.show('ลบรายการแล้ว', 'success');
      load();
    } catch (error) {
      toast.show((error as Error).message, 'error');
    }
  };

  return (
    <AdminLayout
      title="จัดการเนื้อหา"
      description="อัปโหลด จัดหมวดหมู่ และควบคุมการเผยแพร่ทรัพยากรสารสนเทศ"
      actions={
        <div className="editor-actions">
          <Link to="/admin/taxonomy" className="btn btn-outline">
            <Icon name="tag" size={16} /> จัดการหมวดหมู่
          </Link>
          <Link to="/admin/content/new" className="btn btn-primary">
            <Icon name="plus" size={17} /> เพิ่มรายการใหม่
          </Link>
        </div>
      }
    >
      <div className="admin-toolbar">
        <div className="admin-search">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="ค้นหาชื่อเรื่อง ผู้แต่ง หรือ ISBN…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="input" value={status} onChange={(event) => update('status', event.target.value)}>
          <option value="all">ทุกสถานะ</option>
          <option value="published">เผยแพร่แล้ว</option>
          <option value="draft">ฉบับร่าง</option>
        </select>
        <select className="input" value={type} onChange={(event) => update('type', event.target.value)}>
          <option value="">ทุกประเภท</option>
          {Object.entries(typeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={category}
          onChange={(event) => update('category', event.target.value)}
          aria-label="กรองตามหมวดหมู่"
        >
          <option value="">ทุกหมวดหมู่</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="admin-count">{result ? `${formatNumber(result.total)} รายการ` : '…'}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>รายการ</th>
              <th>หมวดหมู่</th>
              <th>สถานะ</th>
              <th className="num">เข้าอ่าน</th>
              <th className="num">ดาวน์โหลด</th>
              <th>อัปเดต</th>
              <th aria-label="การจัดการ" />
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <tr key={index} className="skeleton-row">
                    <td colSpan={7}>
                      <div className="skeleton-block" style={{ height: 44 }} />
                    </td>
                  </tr>
                ))
              : (result?.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-title-cell">
                        <Cover publication={item} className="table-cover" />
                        <div>
                          <Link to={`/item/${item.slug}`} className="table-title">
                            {item.title}
                          </Link>
                          <span className="table-sub">
                            {typeLabels[item.type]} · {item.year ? `พ.ศ. ${item.year}` : 'ไม่ระบุปี'} ·{' '}
                            {formatFileSize(item.fileSize)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="table-category" style={{ color: item.category?.accent }}>
                        {item.category?.name ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-chip status-${item.status}`}>
                        {item.status === 'published' ? 'เผยแพร่' : 'ฉบับร่าง'}
                      </span>
                    </td>
                    <td className="num">{formatNumber(item.reads)}</td>
                    <td className="num">{formatNumber(item.downloads)}</td>
                    <td className="table-date">{formatDate(item.updatedAt)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => togglePublish(item)}
                          disabled={!owned(item)}
                          title={item.status === 'published' ? 'ย้ายเป็นฉบับร่าง' : 'เผยแพร่'}
                          aria-label={item.status === 'published' ? 'ย้ายเป็นฉบับร่าง' : 'เผยแพร่'}
                        >
                          <Icon name={item.status === 'published' ? 'eye' : 'upload'} size={16} />
                        </button>
                        <Link
                          to={`/admin/content/${item.id}/edit`}
                          className="icon-button"
                          title="แก้ไข"
                          aria-label="แก้ไข"
                          aria-disabled={!owned(item)}
                          onClick={(event) => {
                            if (!owned(item)) {
                              event.preventDefault();
                              toast.show('แก้ไขได้เฉพาะรายการที่คุณสร้าง', 'error');
                            }
                          }}
                        >
                          <Icon name="edit" size={16} />
                        </Link>
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => remove(item)}
                          disabled={!owned(item)}
                          title="ลบ"
                          aria-label="ลบ"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && !result?.items.length ? (
          <div className="empty-state compact">
            <Icon name="library" size={26} />
            <h3>ไม่พบรายการในเงื่อนไขนี้</h3>
            <p>ลองเปลี่ยนตัวกรองหรือเพิ่มรายการใหม่เข้าคลัง</p>
            <Link to="/admin/content/new" className="btn btn-primary btn-sm">
              <Icon name="plus" size={15} /> เพิ่มรายการใหม่
            </Link>
          </div>
        ) : null}
      </div>

      {result && result.pages > 1 ? (
        <div className="pagination">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
          >
            ก่อนหน้า
          </button>
          <span className="page-status">
            หน้า {page} จาก {result.pages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={page >= result.pages}
            onClick={() => changePage(page + 1)}
          >
            ถัดไป
          </button>
        </div>
      ) : null}
    </AdminLayout>
  );
}
