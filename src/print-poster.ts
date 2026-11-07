import { POSTER_LAYOUT } from './poster-layout';

export function openPosterPrintWindow(title: string): Window {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Allow pop-ups for this site to open the A4 promo print preview.');
  printWindow.opener = null;
  const document = printWindow.document;
  document.title = `${title} · A4 promo poster`;
  document.documentElement.lang = 'en';
  document.body.replaceChildren();
  const status = document.createElement('p');
  status.textContent = 'Preparing your A4 promo poster…';
  status.setAttribute('role', 'status');
  document.body.append(status);
  return printWindow;
}

export async function printPosterSvg(printWindow: Window, svg: string, title: string): Promise<void> {
  if (printWindow.closed) throw new Error('The print preview was closed before the poster was ready.');
  const document = printWindow.document;
  const { widthMm, heightMm } = POSTER_LAYOUT.page;
  document.title = `${title} · A4 promo poster`;
  const style = document.createElement('style');
  style.textContent = `
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { background: #e8edf1; color: #101b29; font: 15px system-ui, sans-serif; }
    .print-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; padding: 16px; }
    .print-controls p { margin: 0; }
    button { padding: 10px 18px; font: inherit; border: 1px solid #101b29; border-radius: 6px; background: #101b29; color: #fff; cursor: pointer; }
    button:focus-visible { outline: 3px solid #f26b2b; outline-offset: 3px; }
    .poster-sheet { width: ${widthMm}mm; max-width: 100%; margin: 0 auto 24px; background: #fff; }
    .poster-sheet img { display: block; width: 100%; height: auto; }
    @media print {
      html, body { width: ${widthMm}mm; height: ${heightMm}mm; background: #fff; }
      .print-controls { display: none !important; }
      .poster-sheet { width: ${widthMm}mm; height: ${heightMm}mm; max-width: none; margin: 0; break-inside: avoid; }
      .poster-sheet img { width: ${widthMm}mm; height: ${heightMm}mm; }
    }
  `;
  document.head.append(style);
  const controls = document.createElement('div');
  controls.className = 'print-controls';
  const instructions = document.createElement('p');
  instructions.textContent = 'A4 portrait · 100% / Actual size · No margins. Disable browser headers and footers.';
  const printButton = document.createElement('button');
  printButton.type = 'button';
  printButton.textContent = 'Print A4';
  printButton.disabled = true;
  printButton.addEventListener('click', () => { printWindow.focus(); printWindow.print(); });
  controls.append(instructions, printButton);
  const sheet = document.createElement('main');
  sheet.className = 'poster-sheet';
  const image = document.createElement('img');
  image.alt = `${title} · approved DXTECH A4 promo poster`;
  sheet.append(image);
  document.body.replaceChildren(controls, sheet);
  const imageUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    image.src = imageUrl;
    await image.decode();
    if (printWindow.closed) throw new Error('The print preview was closed before the poster was ready.');
    printButton.disabled = false;
    printWindow.focus();
    printWindow.print();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
