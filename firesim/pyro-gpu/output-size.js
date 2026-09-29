// Render at the display's physical resolution, up to the authored 1280 × 720
// ceiling. A 128-pixel width quantum keeps 16:9 exact and readback rows aligned.
export function outputSize(cssWidth, pixelRatio = 1, fullSize = false) {
  if (fullSize || !Number.isFinite(cssWidth) || cssWidth <= 0) return [1280, 720];
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const width = Math.min(1280, Math.max(256, Math.ceil((cssWidth * ratio) / 128) * 128));
  return [width, (width * 9) / 16];
}
