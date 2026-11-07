import displayFontUrl from './assets/poster/poster-display.ttf?url';
import bodyFontUrl from './assets/poster/poster-body.ttf?url';
import { POSTER_LAYOUT, posterPlacementMap } from './poster-layout';

export interface PromoPosterInput {
  title: string;
  description: string;
  durationLabel: string;
  durationNote?: string;
  branchLabel?: string;
  qrSvg?: string;
  sample?: boolean;
}

const PAGE_WIDTH = POSTER_LAYOUT.page.width;
const PAGE_HEIGHT = POSTER_LAYOUT.page.height;
const { frame: QR_FRAME, insertion: QR_INSERTION, placeholderGuide: QR_GUIDE } = POSTER_LAYOUT.qr;
const INK = '#101b29';
const ORANGE = '#f26b2b';
const MUTED = '#52606b';
let fontAssets: Promise<{ display: string; body: string }> | undefined;

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

async function fontData(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Hindi ma-load ang poster fonts. Subukang muli.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Hindi mabasa ang poster font.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function loadPosterFonts(): Promise<{ display: string; body: string }> {
  if (!fontAssets) {
    fontAssets = Promise.all([fontData(displayFontUrl), fontData(bodyFontUrl)]).then(async ([display, body]) => {
      const displayFace = new FontFace('DXTECH Poster Display', `url(${display})`, { weight: '700' });
      const bodyFace = new FontFace('DXTECH Poster Text', `url(${body})`);
      await Promise.all([displayFace.load(), bodyFace.load()]);
      document.fonts.add(displayFace);
      document.fonts.add(bodyFace);
      return { display, body };
    }).catch(error => {
      fontAssets = undefined;
      throw error;
    });
  }
  return fontAssets;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      if (context.measureText(word).width <= maxWidth) { line = word; continue; }
      // A long URL or unbroken title must fit without dropping its characters.
      for (const character of word) {
        if (line && context.measureText(line + character).width > maxWidth) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textBlock(context: CanvasRenderingContext2D, value: string, x: number, top: number, width: number, height: number, largest: number, smallest: number, display = false, color = INK): string {
  const family = display ? 'DXTECH Poster Display' : 'DXTECH Poster Text';
  for (let size = largest; size >= smallest; size--) {
    context.font = `${display ? '700' : '400'} ${size}px "${family}"`;
    const lines = wrapText(context, value, width);
    const lineHeight = size * (display ? 1.02 : 1.35);
    if (lines.length * lineHeight > height) continue;
    return `<text fill="${color}" font-family="${family}" font-weight="${display ? '700' : '400'}" font-size="${size}">${lines.map((line, index) => `<tspan x="${x}" y="${top + size * 0.84 + index * lineHeight}">${xml(line)}</tspan>`).join('')}</text>`;
  }
  throw new Error('Masyadong mahaba ang poster text. Paikliin ang title o description para mabasa sa A4.');
}

function qrArtwork(source: string | undefined): string {
  if (!source) return `
    <rect id="promo-qr-placeholder-guide" x="${QR_GUIDE.x}" y="${QR_GUIDE.y}" width="${QR_GUIDE.width}" height="${QR_GUIDE.height}" fill="#ffffff" stroke="#bac2c8" stroke-dasharray="7 6"/>
    <text x="${QR_GUIDE.x + QR_GUIDE.width / 2}" y="${QR_GUIDE.y + 74}" text-anchor="middle" font-family="DXTECH Poster Display" font-weight="700" font-size="35" fill="${INK}">QR CODE</text>
    <text x="${QR_GUIDE.x + QR_GUIDE.width / 2}" y="${QR_GUIDE.y + 103}" text-anchor="middle" font-family="DXTECH Poster Text" font-size="17" fill="${MUTED}">ilagay dito</text>
    <text x="${QR_GUIDE.x + QR_GUIDE.width / 2}" y="${QR_GUIDE.y + 134}" text-anchor="middle" font-family="DXTECH Poster Text" font-size="10" fill="${MUTED}">RESERVED QR SPACE</text>`;
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || document.querySelector('parsererror, script, foreignObject, image, use, a, style')) {
    throw new Error('Hindi valid ang promo QR. Buksan muli ang share preview.');
  }
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('on') || /href$/i.test(attribute.name)) throw new Error('Hindi valid ang promo QR.');
    }
  }
  root.setAttribute('id', 'promo-qr-code');
  root.setAttribute('x', String(QR_INSERTION.x)); root.setAttribute('y', String(QR_INSERTION.y));
  root.setAttribute('width', String(QR_INSERTION.width)); root.setAttribute('height', String(QR_INSERTION.height));
  return new XMLSerializer().serializeToString(root);
}

export async function createPromoPosterSvg(input: PromoPosterInput): Promise<string> {
  const fonts = await loadPosterFonts();
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Hindi available ang poster renderer sa browser na ito.');
  const title = textBlock(context, input.title.trim().toUpperCase(), 58, 166, 672, 258, 128, 35, true);
  const description = input.description.trim()
    ? textBlock(context, input.description.trim(), 62, 445, 660, 152, 27, 16)
    : '';
  const duration = textBlock(context, input.durationLabel, 62, 665, 658, 105, 82, 25, true);
  const durationNote = input.durationNote ? textBlock(context, input.durationNote, 62, 794, 660, 42, 17, 12, false, MUTED) : '';
  const branch = input.branchLabel ? textBlock(context, input.branchLabel, 316, 1014, 408, 45, 15, 10, false, MUTED) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_LAYOUT.page.widthMm}mm" height="${POSTER_LAYOUT.page.heightMm}mm" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}" preserveAspectRatio="none" role="img" aria-labelledby="poster-title poster-description">
  <title id="poster-title">${xml(input.title)} · DXTECH PisoWiFi</title>
  <desc id="poster-description">${xml(input.description)}. Oras: ${xml(input.durationLabel)}. ${input.qrSvg ? 'May promo QR code.' : 'May nakalaang kahon para sa promo QR code.'}</desc>
  <metadata id="promo-poster-placement">${xml(JSON.stringify(posterPlacementMap()))}</metadata>
  <defs><style>
    @font-face{font-family:'DXTECH Poster Display';font-weight:700;src:url('${fonts.display}') format('truetype')}
    @font-face{font-family:'DXTECH Poster Text';font-weight:400;src:url('${fonts.body}') format('truetype')}
  </style></defs>
  <rect width="794" height="1123" fill="#ffffff"/>
  <rect x="778" width="16" height="1123" fill="${ORANGE}"/>
  <path d="M58 47h10v33H58zm17-11h10v44H75zm17-12h10v56H92z" fill="${ORANGE}"/>
  <text x="119" y="66" font-family="DXTECH Poster Display" font-weight="700" font-size="48" fill="${INK}">DXTECH</text>
  <text x="121" y="91" font-family="DXTECH Poster Text" font-size="16" letter-spacing="2.8" fill="${INK}">PISOWIFI HUB</text>
  <text x="730" y="59" text-anchor="end" font-family="DXTECH Poster Text" font-size="12" fill="${MUTED}">KONEKTADO ANG KOMUNIDAD.</text>
  <path d="M58 126H730" stroke="${INK}" stroke-width="2"/>
  ${title}
  ${description}
  <rect x="42" y="620" width="704" height="160" rx="4" fill="${ORANGE}"/>
  <text x="62" y="650" font-family="DXTECH Poster Text" font-size="16" letter-spacing="2" fill="${INK}">ORAS NG PROMO</text>
  ${duration}
  ${durationNote}
  <rect id="promo-qr-frame" x="${QR_FRAME.x}" y="${QR_FRAME.y}" width="${QR_FRAME.width}" height="${QR_FRAME.height}" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>
  ${qrArtwork(input.qrSvg)}
  <path d="M${QR_FRAME.x} ${QR_FRAME.y + 23}v-23h23m${QR_FRAME.width - 46} 0h23v23M${QR_FRAME.x} ${QR_FRAME.y + QR_FRAME.height - 23}v23h23m${QR_FRAME.width - 46} 0h23v-23" fill="none" stroke="${ORANGE}" stroke-width="6"/>
  <text x="316" y="884" font-family="DXTECH Poster Display" font-weight="700" font-size="44" fill="${INK}">I-SCAN PARA</text>
  <text x="316" y="930" font-family="DXTECH Poster Display" font-weight="700" font-size="44" fill="${INK}">SA PROMO.</text>
  <text x="317" y="962" font-family="DXTECH Poster Text" font-size="16" fill="${INK}">Kumonek sa DXTECH PisoWiFi.</text>
  <text x="317" y="987" font-family="DXTECH Poster Text" font-size="16" fill="${INK}">${input.qrSvg ? 'I-scan, buksan ang hub, at sundin ang instructions.' : 'Ilagay ang promo QR sa kahon bago i-print.'}</text>
  ${branch}
  <path d="M58 1080H730" stroke="#d4dbe0"/>
  <text x="58" y="1101" font-family="DXTECH Poster Text" font-size="11" fill="${MUTED}">${input.sample ? 'DESIGN PREVIEW · HALIMBAWANG PROMO AT ORAS' : 'DXTECH PisoWiFi Hub'}</text>
  <text x="730" y="1101" text-anchor="end" font-family="DXTECH Poster Text" font-size="11" fill="${MUTED}">${input.qrSvg ? 'I-scan ang promo link. Walang voucher code sa poster.' : 'QR PLACEHOLDER · PALITAN BAGO I-PRINT'}</text>
</svg>`;
}

function pngAt300Dpi(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 33;
  let replaced = 0;
  for (let cursor = 8; cursor + 12 <= bytes.length;) {
    const length = view.getUint32(cursor);
    const kind = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (kind === 'pHYs') { offset = cursor; replaced = length + 12; break; }
    cursor += length + 12;
  }
  const chunk = new Uint8Array(21);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  chunkView.setUint32(8, 11811); chunkView.setUint32(12, 11811); chunk[16] = 1;
  let crc = 0xffffffff;
  for (let index = 4; index < 17; index++) {
    crc ^= chunk[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunkView.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const result = new Uint8Array(bytes.length - replaced + chunk.length);
  result.set(bytes.subarray(0, offset)); result.set(chunk, offset);
  result.set(bytes.subarray(offset + replaced), offset + chunk.length);
  return result;
}

export async function posterSvgToPng(svg: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_LAYOUT.png.width; canvas.height = POSTER_LAYOUT.png.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Hindi available ang PNG export sa browser na ito.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Hindi ma-export ang poster.')), 'image/png'));
    return new Blob([pngAt300Dpi(new Uint8Array(await blob.arrayBuffer()))], { type: 'image/png' });
  } finally { URL.revokeObjectURL(url); }
}
