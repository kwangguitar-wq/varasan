import { api } from './api';

export type UploadConfig = {
  mode: 'multipart' | 'chunked';
  chunkBytes: number;
  maxFileBytes: number;
};

let cached: UploadConfig | null = null;

export async function getUploadConfig(): Promise<UploadConfig> {
  if (!cached) cached = await api.get<UploadConfig>('/api/uploads/config');
  return cached;
}

async function sendChunk(uploadId: string, index: number, chunk: Blob) {
  const response = await fetch(`/api/uploads/${uploadId}/chunk/${index}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk,
  });
  if (!response.ok) {
    const payload: { error?: string } | null = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `อัปโหลดไฟล์ไม่สำเร็จ (${response.status})`);
  }
}

/**
 * Sends a book (or cover) in pieces so it also works on hosts that reject large
 * request bodies, then lets the server join and index the file.
 */
export async function uploadInChunks(
  publicationId: number,
  kind: 'file' | 'cover',
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const config = await getUploadConfig();
  if (file.size > config.maxFileBytes) {
    const limit = Math.round(config.maxFileBytes / (1024 * 1024));
    throw new Error(`ไฟล์ใหญ่เกินกำหนดของเซิร์ฟเวอร์นี้ (สูงสุด ${limit} MB)`);
  }

  const session = await api.post<{ id: string; chunkBytes: number; parts: number }>('/api/uploads/start', {
    publicationId,
    kind,
    filename: file.name,
    size: file.size,
  });

  try {
    const total = Math.max(1, Math.ceil(file.size / session.chunkBytes));
    for (let index = 0; index < total; index += 1) {
      const start = index * session.chunkBytes;
      await sendChunk(session.id, index + 1, file.slice(start, Math.min(file.size, start + session.chunkBytes)));
      onProgress?.(Math.round(((index + 1) / total) * 100));
    }
    await api.post(`/api/uploads/${session.id}/finish`);
  } catch (error) {
    await api.delete(`/api/uploads/${session.id}`).catch(() => null);
    throw error;
  }
}
