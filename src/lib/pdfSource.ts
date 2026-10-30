/**
 * How much of a book the proxy hands back per response. The Function that
 * serves `/uploads/*` caps every reply at this size (Vercel limits a Function
 * body), so the reader asks for the file window by window.
 */
const WINDOW_BYTES = 3 * 1024 * 1024;

function totalFromHeaders(response: Response, received: number) {
  const range = response.headers.get('content-range');
  const match = range ? /\/(\d+)\s*$/.exec(range) : null;
  if (match) return Number(match[1]);
  return received;
}

/**
 * Downloads a book as bytes before handing it to pdf.js.
 *
 * pdf.js opens with a plain GET and no `Range` header. The proxy answers such a
 * request for a book bigger than one window with only the first window, and
 * pdf.js takes that reply as the whole document — it then looks for the trailer
 * inside those bytes and fails with "Invalid PDF structure". Requesting explicit
 * ranges keeps `Content-Range` in play, so every window lands where it belongs
 * and books of any size open.
 */
export async function loadPdfBytes(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let received = 0;

  while (total === 0 || received < total) {
    const response = await fetch(url, {
      headers: { Range: `bytes=${received}-${received + WINDOW_BYTES - 1}` },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`โหลดไฟล์ PDF ไม่สำเร็จ (${response.status})`);
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (!chunk.length) break;
    chunks.push(chunk);
    received += chunk.length;
    if (total === 0) total = totalFromHeaders(response, received);
    onProgress?.(total ? Math.min(100, Math.round((received / total) * 100)) : 0);
    // A plain 200 means the host sent the entire file in one go.
    if (response.status === 200) break;
  }

  if (!received) throw new Error('ไฟล์ PDF ว่างเปล่า');
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
