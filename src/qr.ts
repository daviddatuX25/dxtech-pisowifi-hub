import QRCode from 'qrcode';

export async function generateQrSvg(text: string): Promise<string> {
  try {
    const svgString = await QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
      width: 220,
    });
    return svgString;
  } catch (err) {
    console.error('Failed to generate QR SVG:', err);
    return `<div class="qr-fallback" style="padding: 24px; text-align: center; color: var(--ink-muted);">QR Code not available</div>`;
  }
}
