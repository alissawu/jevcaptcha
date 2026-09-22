/**
 * Simple slider CAPTCHA solver
 * 
 * Handles "slide to verify" type captchas where you just drag a handle to the end.
 * NOT for puzzle sliders (GeeTest) - those need vision to find the target position.
 */

import type { Page, Locator } from 'playwright';

export interface SliderSelectors {
  /** The draggable handle/button */
  handle: string;
  /** The track/rail the handle slides on */
  track: string;
  /** Optional: success indicator to check after sliding */
  success?: string;
}

const DEFAULT_SELECTORS: SliderSelectors = {
  handle: '[class*="slider-handle"], [class*="slider-btn"], [class*="slide-btn"], button[aria-label*="slide"], .slider-button, .drag-handle',
  track: '[class*="slider-track"], [class*="slider-bar"], [class*="slide-track"], .slider-container, .slider-rail',
  success: '[class*="success"], [class*="verified"], .slider-success',
};

export interface SlideResult {
  success: boolean;
  error?: string;
  duration: number;
}

/**
 * Solve a simple drag-to-end slider captcha
 */
export async function solveSlider(
  page: Page,
  selectors: Partial<SliderSelectors> = {},
  options: { humanize?: boolean } = {}
): Promise<SlideResult> {
  const sel = { ...DEFAULT_SELECTORS, ...selectors };
  const startTime = Date.now();
  
  try {
    // Find handle and track
    const handle = page.locator(sel.handle).first();
    const track = page.locator(sel.track).first();
    
    // Wait for elements
    await handle.waitFor({ state: 'visible', timeout: 5000 });
    
    // Get positions
    const handleBox = await handle.boundingBox();
    const trackBox = await track.boundingBox();
    
    if (!handleBox || !trackBox) {
      return { success: false, error: 'Could not find slider elements', duration: Date.now() - startTime };
    }
    
    // Calculate drag distance
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = trackBox.x + trackBox.width - handleBox.width / 2 - 5; // slight padding
    
    // Perform the drag
    if (options.humanize) {
      await humanizedDrag(page, startX, startY, endX, startY);
    } else {
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, startY, { steps: 20 });
      await page.mouse.up();
    }
    
    // Check for success
    await page.waitForTimeout(500);
    
    if (sel.success) {
      const successEl = page.locator(sel.success);
      const isSuccess = await successEl.count() > 0;
      return { success: isSuccess, duration: Date.now() - startTime };
    }
    
    return { success: true, duration: Date.now() - startTime };
    
  } catch (e: any) {
    return { success: false, error: e.message, duration: Date.now() - startTime };
  }
}

/**
 * Human-like drag with slight variations
 */
async function humanizedDrag(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Promise<void> {
  const distance = endX - startX;
  const steps = Math.max(20, Math.floor(distance / 10));
  
  await page.mouse.move(startX, startY);
  await page.waitForTimeout(randomDelay(50, 150));
  await page.mouse.down();
  await page.waitForTimeout(randomDelay(30, 80));
  
  // Move with slight wobble
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    // Ease out curve
    const eased = 1 - Math.pow(1 - progress, 2);
    const x = startX + (endX - startX) * eased;
    const y = startY + (Math.random() - 0.5) * 2; // tiny vertical wobble
    
    await page.mouse.move(x, y);
    await page.waitForTimeout(randomDelay(5, 15));
  }
  
  await page.waitForTimeout(randomDelay(20, 60));
  await page.mouse.up();
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * SmartRecruiters specific slider solver
 */
export async function solveSmartRecruitersSlider(page: Page): Promise<SlideResult> {
  return solveSlider(page, {
    handle: 'button:has-text("→"), [aria-label*="slide"], .slider-handle',
    track: '[class*="slider"], [class*="captcha-container"]',
  }, { humanize: true });
}
