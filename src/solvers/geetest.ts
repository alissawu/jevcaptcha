/**
 * GeeTest Slider Captcha Solver — Local Pixel-Based
 *
 * Uses combined darkest-slice + shape matching to detect the gap position
 * in GeeTest slider puzzles, then performs a humanized drag to solve.
 *
 * Zero marginal cost per solve — no third-party API needed.
 *
 * Supported:
 *   - Slider/drag-to-shadow puzzles
 *   - Puzzle piece matching
 *
 * NOT supported (need different approach):
 *   - Click-in-order challenges
 *   - Icon selection challenges
 */

import type { Page } from 'playwright';
import sharp from 'sharp';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeeTestResult {
  solved: boolean;
  gapX?: number;
  pieceX?: number;
  dragPx?: number;
  durationMs: number;
  error?: string;
}

export interface GeeTestOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Check if a GeeTest slider captcha is visible.
 */
export async function hasGeeTestSlider(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const bg = document.querySelector('.geetest_bg');
    if (!bg) return false;
    const style = getComputedStyle(bg);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = bg.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

/**
 * Check if GeeTest shows success state.
 */
export async function isGeeTestSuccess(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // If puzzle background is still visible, not solved yet
    const bg = document.querySelector('.geetest_bg');
    if (bg) {
      const style = getComputedStyle(bg);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const rect = bg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return false;
      }
    }

    // Look for success indicators within GeeTest widget
    const containers = document.querySelectorAll(
      '.geetest_holder, .geetest_panel, .geetest_box, .geetest_captcha'
    );

    for (const container of Array.from(containers)) {
      if (container.querySelector('.geetest_success, .geetest_panel_success')) {
        return true;
      }
      const text = container.textContent || '';
      if (text.includes('Verification Success') || text.includes('验证成功')) {
        return true;
      }
    }

    return false;
  });
}

// ─── Gap Detection ────────────────────────────────────────────────────────────

/**
 * Detect gap position using combined darkness + shape matching.
 *
 * 1. Darkest-slice: finds dark shadow regions
 * 2. Shape matching: correlates piece edges with background edges
 * 3. If methods agree (<15px), use average
 * 4. If they disagree, prefer shape matching (robust to misleading dark areas)
 */
async function detectGapCombined(
  page: Page,
  log: (msg: string) => void
): Promise<{ gapX: number; pieceX: number; visualWidth: number }> {
  // Get puzzle background bounds
  const bgRect = (await page.evaluate(() => {
    const bg = document.querySelector('.geetest_bg');
    if (!bg) return null;
    const rect = bg.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })) as Rect | null;

  if (!bgRect || bgRect.width === 0) {
    throw new Error('GeeTest puzzle not visible');
  }

  // Get piece position
  const sliceRect = (await page.evaluate(() => {
    const slice = document.querySelector('.geetest_slice');
    if (!slice) return null;
    const rect = slice.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })) as Rect | null;

  const pieceX = sliceRect
    ? sliceRect.x + sliceRect.width / 2 - bgRect.x
    : bgRect.width * 0.1;

  // Capture images
  const bgShot = (await page.screenshot({ type: 'png', clip: bgRect })) as Buffer;
  const pieceShot = sliceRect
    ? ((await page.screenshot({ type: 'png', clip: sliceRect })) as Buffer)
    : null;

  // Get image metadata
  const bgMeta = await sharp(bgShot).metadata();
  const bgWidth = bgMeta.width!;
  const bgHeight = bgMeta.height!;
  const dpr = bgWidth / bgRect.width;

  const bgGray = await sharp(bgShot).grayscale().raw().toBuffer();

  // Search parameters (skip left 25% where piece sits)
  const startX = Math.floor(bgWidth * 0.25);
  const endX = bgWidth - Math.floor(bgWidth * 0.15);
  const step = 3;

  // === Method 1: Darkest slice ===
  const sliceWidth = Math.floor(bgWidth * 0.12);
  let darkestX = startX;
  let darkestBrightness = Infinity;
  const brightnesses: number[] = [];

  for (let x = startX; x < endX; x += step) {
    let sum = 0;
    for (let y = Math.floor(bgHeight * 0.1); y < Math.floor(bgHeight * 0.9); y++) {
      for (let dx = 0; dx < sliceWidth; dx++) {
        if (x + dx < bgWidth) sum += bgGray[y * bgWidth + x + dx];
      }
    }
    const avg = sum / (Math.floor(bgHeight * 0.8) * sliceWidth);
    brightnesses.push(avg);
    if (avg < darkestBrightness) {
      darkestBrightness = avg;
      darkestX = x;
    }
  }

  const darkGapPng = darkestX + sliceWidth / 2;
  const darkGapVisual = darkGapPng / dpr;

  // Darkness confidence
  const avgBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
  const darkConfidence = (avgBrightness - darkestBrightness) / avgBrightness;

  // === Method 2: Shape matching ===
  let shapeGapVisual = darkGapVisual;
  let shapeConfidence = 0;

  if (pieceShot) {
    const pieceMeta = await sharp(pieceShot).metadata();
    const pieceWidth = pieceMeta.width!;
    const pieceHeight = pieceMeta.height!;
    const pieceGray = await sharp(pieceShot).grayscale().raw().toBuffer();

    // Compute vertical edges on background
    const bgEdges = new Uint8Array(bgWidth * bgHeight);
    for (let y = 1; y < bgHeight - 1; y++) {
      for (let x = 1; x < bgWidth - 1; x++) {
        const left = bgGray[y * bgWidth + (x - 1)];
        const right = bgGray[y * bgWidth + (x + 1)];
        bgEdges[y * bgWidth + x] = Math.abs(right - left);
      }
    }

    // Compute vertical edges on piece
    const pieceEdges = new Uint8Array(pieceWidth * pieceHeight);
    for (let y = 1; y < pieceHeight - 1; y++) {
      for (let x = 1; x < pieceWidth - 1; x++) {
        const left = pieceGray[y * pieceWidth + (x - 1)];
        const right = pieceGray[y * pieceWidth + (x + 1)];
        pieceEdges[y * pieceWidth + x] = Math.abs(right - left);
      }
    }

    // Find significant piece boundary edges (left/right zones)
    const leftZone = Math.floor(pieceWidth * 0.15);
    const rightZone = Math.floor(pieceWidth * 0.85);
    const pieceEdgePositions: { x: number; y: number }[] = [];

    for (let y = 5; y < pieceHeight - 5; y++) {
      for (let x = 0; x < leftZone; x++) {
        if (pieceEdges[y * pieceWidth + x] > 40) {
          pieceEdgePositions.push({ x, y });
        }
      }
      for (let x = rightZone; x < pieceWidth; x++) {
        if (pieceEdges[y * pieceWidth + x] > 40) {
          pieceEdgePositions.push({ x, y });
        }
      }
    }

    // Slide and correlate
    let bestShapeX = startX;
    let bestShapeScore = 0;

    for (let offsetX = startX; offsetX < endX; offsetX += step) {
      let score = 0;
      for (const { x: px, y: py } of pieceEdgePositions) {
        const bgX = offsetX + px;
        const bgY = py;
        if (bgX >= 0 && bgX < bgWidth && bgY >= 0 && bgY < bgHeight) {
          score += bgEdges[bgY * bgWidth + bgX];
        }
      }
      if (score > bestShapeScore) {
        bestShapeScore = score;
        bestShapeX = offsetX;
      }
    }

    const shapeGapPng = bestShapeX + pieceWidth / 2;
    shapeGapVisual = shapeGapPng / dpr;
    shapeConfidence =
      pieceEdgePositions.length > 0 ? bestShapeScore / (pieceEdgePositions.length * 50) : 0;
  }

  // === Decision logic ===
  const diff = Math.abs(darkGapVisual - shapeGapVisual);
  let gapX: number;

  if (diff < 15) {
    gapX = (darkGapVisual + shapeGapVisual) / 2;
    log(`[GeeTest] Methods agree (diff=${diff.toFixed(1)}px), using average: ${gapX.toFixed(1)}`);
  } else if (shapeConfidence > 0.3 || (pieceShot && darkConfidence < 0.15)) {
    gapX = shapeGapVisual;
    log(`[GeeTest] Methods disagree (diff=${diff.toFixed(1)}px), trusting shape: ${gapX.toFixed(1)}`);
  } else {
    gapX = darkGapVisual;
    log(`[GeeTest] Methods disagree (diff=${diff.toFixed(1)}px), trusting darkness: ${gapX.toFixed(1)}`);
  }

  return { gapX, pieceX, visualWidth: bgRect.width };
}

// ─── Humanized Drag ───────────────────────────────────────────────────────────

async function humanizedDrag(page: Page, distance: number): Promise<void> {
  const btnRect = (await page.evaluate(() => {
    const btn = document.querySelector('.geetest_btn');
    if (!btn) return null;
    const rect = btn.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })) as Rect | null;

  if (!btnRect) {
    throw new Error('GeeTest slider button not found');
  }

  const startX = btnRect.x + btnRect.width / 2;
  const startY = btnRect.y + btnRect.height / 2;

  // Move to start and press
  await page.mouse.move(startX, startY);
  await sleep(100 + Math.random() * 100);
  await page.mouse.down();
  await sleep(50 + Math.random() * 50);

  // Drag with cubic ease-out and y-jitter
  const steps = 20 + Math.floor(Math.random() * 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);
    const x = startX + distance * eased;
    const y = startY + (Math.random() - 0.5) * 4;

    await page.mouse.move(x, y);
    await sleep(8 + Math.random() * 14);
  }

  // Overshoot and correction
  const overshoot = 3 + Math.random() * 4;
  await page.mouse.move(startX + distance + overshoot, startY);
  await sleep(30 + Math.random() * 40);
  await page.mouse.move(startX + distance, startY);
  await sleep(25 + Math.random() * 25);

  await page.mouse.up();
}

// ─── Main Solver ──────────────────────────────────────────────────────────────

/**
 * Solve a GeeTest slider captcha using local pixel-based detection.
 */
export async function solveGeeTest(
  page: Page,
  opts: GeeTestOptions = {}
): Promise<GeeTestResult> {
  const { maxAttempts = 3, timeoutMs = 30_000, log = () => {} } = opts;

  const start = Date.now();
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts && Date.now() - start < timeoutMs; attempt++) {
    try {
      if (await isGeeTestSuccess(page)) {
        return { solved: true, durationMs: Date.now() - start };
      }

      if (!(await hasGeeTestSlider(page))) {
        lastError = 'GeeTest slider not visible';
        await sleep(500);
        continue;
      }

      log(`[GeeTest] Attempt ${attempt}/${maxAttempts}`);

      const { gapX, pieceX, visualWidth } = await detectGapCombined(page, log);
      log(`[GeeTest] Gap at ${gapX.toFixed(1)}, piece at ${pieceX.toFixed(1)}, width ${visualWidth.toFixed(0)}`);

      const dragDistance = gapX - pieceX;
      log(`[GeeTest] Dragging ${Math.round(dragDistance)}px`);

      await humanizedDrag(page, dragDistance);
      await sleep(2000);

      if (await isGeeTestSuccess(page)) {
        log('[GeeTest] Solved!');
        return {
          solved: true,
          gapX,
          pieceX,
          dragPx: dragDistance,
          durationMs: Date.now() - start,
        };
      }

      const stillVisible = await hasGeeTestSlider(page);
      if (stillVisible) {
        lastError = `Drag ${Math.round(dragDistance)}px failed`;
        log(`[GeeTest] ${lastError}, retrying...`);
        await sleep(1000);
      } else {
        // Puzzle closed, might be success we didn't detect
        return {
          solved: true,
          gapX,
          pieceX,
          dragPx: dragDistance,
          durationMs: Date.now() - start,
        };
      }
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      log(`[GeeTest] Error: ${lastError}`);
      await sleep(1000);
    }
  }

  return {
    solved: false,
    durationMs: Date.now() - start,
    error: lastError,
  };
}

/**
 * Solve GeeTest slider if present, otherwise return null.
 */
export async function solveGeeTestIfPresent(
  page: Page,
  opts: GeeTestOptions = {}
): Promise<GeeTestResult | null> {
  const hasWidget = await page.evaluate(() => {
    return !!document.querySelector('.geetest_holder, [class*="geetest"]');
  });

  if (!hasWidget) return null;

  const [hasSlider, hasSuccess] = await Promise.all([
    hasGeeTestSlider(page),
    isGeeTestSuccess(page),
  ]);

  if (hasSuccess) return { solved: true, durationMs: 0 };
  if (!hasSlider) return null;

  return solveGeeTest(page, opts);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
