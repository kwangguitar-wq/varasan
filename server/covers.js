const PALETTES = [
  ['#0f766e', '#134e4a', '#f0fdfa'],
  ['#4338ca', '#1e1b4b', '#eef2ff'],
  ['#be185d', '#500724', '#fff1f2'],
  ['#b45309', '#451a03', '#fffbeb'],
  ['#0369a1', '#082f49', '#f0f9ff'],
  ['#6d28d9', '#2e1065', '#f5f3ff'],
  ['#047857', '#052e16', '#ecfdf5'],
  ['#c2410c', '#431407', '#fff7ed'],
];

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 1000003;
  return h;
}

const isThaiMark = (code) =>
  code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);

function charWidth(char, size) {
  const code = char.codePointAt(0) ?? 0;
  if (isThaiMark(code)) return 0;
  if (code === 0x20) return 0.3;
  if (code >= 0x0e01 && code <= 0x0e5b) return 0.58;
  if (code >= 0x0e50 && code <= 0x0e59) return 0.5;
  if (/[A-Z0-9]/.test(char)) return 0.62;
  if (/[a-z]/.test(char)) return 0.5;
  if (/[.,:;'’!|()·]/.test(char)) return 0.28;
  return 0.52;
}

function measure(text, size) {
  let width = 0;
  for (const char of text) width += charWidth(char, size);
  return width * size;
}

export function wrapText(text, size, maxWidth, maxLines = 4) {
  const chars = [...String(text ?? '').trim()];
  const lines = [];
  let line = '';
  for (const char of chars) {
    if (measure(line + char, size) > maxWidth && line && !isThaiMark(char.codePointAt(0) ?? 0)) {
      lines.push(line.trimEnd());
      line = char === ' ' ? '' : char;
    } else {
      line += char;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(3, kept[maxLines - 1].length - 1))}…`;
  return kept;
}

export function generateCoverSvg({ title, author = '', type = 'ebook', category = '', id = 0 }) {
  const seed = hash(`${title}${author}${id}`);
  const [a, b, ink] = PALETTES[seed % PALETTES.length];
  let titleSize = 58;
  let lines = wrapText(title, titleSize, 500, 4);
  if (lines.length > 4) {
    titleSize = 48;
    lines = wrapText(title, titleSize, 500, 5);
  }
  if (lines.length > 5) {
    titleSize = 42;
    lines = wrapText(title, titleSize, 500, 5);
  }
  const lineHeight = titleSize + 9;
  const startY = 600 - (lines.length - 1) * lineHeight;
  const titleTspans = lines
    .map((line, index) => `<tspan x="70" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  const angle = seed % 30;
  const typeLabel =
    { journal: 'JOURNAL', ebook: 'E-BOOK', research: 'RESEARCH', flipbook: 'FLIPBOOK', report: 'REPORT', magazine: 'MAGAZINE' }[type] ??
    'E-BOOK';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 900" width="640" height="900" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}" />
      <stop offset="100%" stop-color="${b}" />
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.12" r="0.8">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.32" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
    <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
      <rect width="6" height="6" fill="transparent" />
      <circle cx="1" cy="1" r="0.6" fill="${ink}" fill-opacity="0.16" />
    </pattern>
  </defs>
  <rect width="640" height="900" fill="url(#g)" />
  <rect width="640" height="900" fill="url(#grain)" />
  <rect width="640" height="900" fill="url(#glow)" />
  <g opacity="0.16" fill="none" stroke="${ink}" stroke-width="2">
    <circle cx="560" cy="150" r="170" />
    <circle cx="560" cy="150" r="120" />
    <circle cx="560" cy="150" r="70" />
    <path d="M-40 780 C 160 700, 300 860, 700 720" />
    <path d="M-40 830 C 160 750, 300 910, 700 770" />
  </g>
  <rect x="70" y="82" width="${typeLabel.length * 13 + 34}" height="38" rx="19" fill="${ink}" fill-opacity="0.16" stroke="${ink}" stroke-opacity="0.35" />
  <text x="87" y="107" font-family="Inter, 'IBM Plex Sans Thai', sans-serif" font-size="15" letter-spacing="3" fill="${ink}" fill-opacity="0.92">${typeLabel}</text>
  <text x="70" y="190" font-family="'IBM Plex Sans Thai', sans-serif" font-size="20" fill="${ink}" fill-opacity="0.7">${escapeXml(category)}</text>
  <text font-family="'IBM Plex Sans Thai', 'Noto Sans Thai', sans-serif" font-weight="600" font-size="${titleSize}" fill="${ink}" letter-spacing="-0.5">${titleTspans}</text>
  <line x1="70" y1="720" x2="180" y2="720" stroke="${ink}" stroke-opacity="0.5" stroke-width="3" />
  <text x="70" y="768" font-family="'IBM Plex Sans Thai', sans-serif" font-size="26" fill="${ink}" fill-opacity="0.85">${escapeXml(author)}</text>
  <text x="70" y="836" font-family="Inter, sans-serif" font-size="15" letter-spacing="4" fill="${ink}" fill-opacity="0.45">NAKHONMAESOT LIBRARY</text>
</svg>`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
