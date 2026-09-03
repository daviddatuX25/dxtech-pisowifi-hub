import { describe, expect, it } from 'vitest';
import { generateQrSvg } from './qr';
import { checkRouterReachability, invalidateRouterCache } from './network';

describe('QR Code Generator & Router Detector', () => {
  it('generates valid SVG XML string for promo URL', async () => {
    const testUrl = 'https://dxtech.example.com/#/promo/test-123';
    const svg = await generateQrSvg(testUrl);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox');
  });

  it('handles offline router probe without throwing', async () => {
    invalidateRouterCache();
    // Non-routable IP should return false cleanly within timeout
    const reachable = await checkRouterReachability('http://192.0.2.1/', 300);
    expect(typeof reachable).toBe('boolean');
  });
});
