import type { PublicationType, Role } from './types';

export const typeLabels: Record<PublicationType, string> = {
  journal: 'วารสาร',
  ebook: 'หนังสือ',
  research: 'งานวิจัย',
  flipbook: 'Flipbook',
  report: 'รายงาน',
  magazine: 'นิตยสาร',
};

export const roleLabels: Record<Role, string> = {
  admin: 'ผู้ดูแลระบบ',
  editor: 'ผู้เขียน / บรรณาธิการ',
  reader: 'ผู้อ่าน',
};

export const fileLabels: Record<string, string> = {
  pdf: 'PDF',
  epub: 'ePub',
  flipbook: 'Flipbook',
};

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('th-TH').format(Number(value ?? 0));
}

export function formatCompact(value: number | null | undefined) {
  return new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', ...options }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatFileSize(bytes: number | null | undefined) {
  const size = Number(bytes ?? 0);
  if (!size) return '—';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  return formatDate(value);
}

export function initials(name: string) {
  return name
    .replace(/^(ดร\.|ศ\.|รศ\.|ผศ\.|นาง|นาย|นางสาว)\s*/u, '')
    .trim()
    .slice(0, 1);
}

export function biblioYear(year: number | null | undefined) {
  return year ? `พ.ศ. ${year}` : '—';
}

export function truncate(text: string | null | undefined, length = 120) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}
