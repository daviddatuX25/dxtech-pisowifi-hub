export interface PosterRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const POSTER_LAYOUT = {
  page: { width: 794, height: 1123, widthMm: 210, heightMm: 297 },
  png: { width: 2480, height: 3508, dpi: 300 },
  qr: {
    frame: { x: 58, y: 847, width: 216, height: 216 },
    insertion: { x: 74, y: 863, width: 184, height: 184 },
    placeholderGuide: { x: 77, y: 866, width: 178, height: 178 },
  },
} as const;

function scaleRectangle(rect: PosterRectangle, width: number, height: number): PosterRectangle {
  return {
    x: rect.x * width / POSTER_LAYOUT.page.width,
    y: rect.y * height / POSTER_LAYOUT.page.height,
    width: rect.width * width / POSTER_LAYOUT.page.width,
    height: rect.height * height / POSTER_LAYOUT.page.height,
  };
}

export function posterPlacementMap() {
  return {
    origin: 'top-left',
    svgPreserveAspectRatio: 'none',
    printScale: '100%; A4 portrait; zero CSS page margins; printer scaling changes placement',
    page: POSTER_LAYOUT.page,
    png: POSTER_LAYOUT.png,
    qr: Object.fromEntries(Object.entries(POSTER_LAYOUT.qr).map(([name, rectangle]) => [name, {
      svgUnits: rectangle,
      millimetres: scaleRectangle(rectangle, POSTER_LAYOUT.page.widthMm, POSTER_LAYOUT.page.heightMm),
      pngPixels: scaleRectangle(rectangle, POSTER_LAYOUT.png.width, POSTER_LAYOUT.png.height),
    }])),
  };
}
