/**
 * GeeTest slider with edge detection (no vision model)
 * 
 * The gap creates a vertical discontinuity - a dark edge on its left side.
 * Use sobel/canny edge detection to find it.
 */

import { chromium } from 'patchright';
import { execSync } from 'child_process';
import * as fs from 'fs';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';

// Python script for edge detection
const EDGE_DETECT_PY = `
import cv2
import numpy as np
import sys
import json

def find_gap(bg_path: str, slice_path: str) -> int:
    """Find gap position using edge detection"""
    
    # Load images
    bg = cv2.imread(bg_path)
    slice_img = cv2.imread(slice_path)
    
    if bg is None or slice_img is None:
        return -1
    
    # Convert to grayscale
    bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    slice_gray = cv2.cvtColor(slice_img, cv2.COLOR_BGR2GRAY)
    
    # Method 1: Template matching with edges
    # Get edges of both images
    bg_edges = cv2.Canny(bg_gray, 100, 200)
    slice_edges = cv2.Canny(slice_gray, 100, 200)
    
    # Template match the edges
    result = cv2.matchTemplate(bg_edges, slice_edges, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    
    # Template matching finds where slice came FROM, not the gap
    # Skip this method for gap detection
    
    # Method 2: Look for vertical edge discontinuity (shadow edge)
    # The gap creates a strong vertical edge on its left side
    sobel_x = cv2.Sobel(bg_gray, cv2.CV_64F, 1, 0, ksize=3)
    sobel_x = np.abs(sobel_x)
    
    # Sum vertical edges per column (looking for strong vertical line)
    col_sums = np.sum(sobel_x, axis=0)
    
    # The gap is usually in middle portion, not at edges
    search_start = 30
    search_end = len(col_sums) - 30
    
    # Find peaks in edge strength
    col_sums_middle = col_sums[search_start:search_end]
    gap_x = int(search_start + np.argmax(col_sums_middle))
    
    return gap_x

if __name__ == "__main__":
    bg_path = sys.argv[1]
    slice_path = sys.argv[2]
    gap_x = find_gap(bg_path, slice_path)
    print(json.dumps({"gap_x": gap_x, "method": "edge_detection"}))
`;

async function findGapWithEdgeDetection(bgPath: string, slicePath: string): Promise<number | null> {
  // Write python script
  const pyPath = '/tmp/geetest_edge.py';
  fs.writeFileSync(pyPath, EDGE_DETECT_PY);
  
  try {
    const result = execSync(`/opt/hako/packages/python/3.14.4/bin/python3 ${pyPath} ${bgPath} ${slicePath}`, { encoding: 'utf-8' });
    const data = JSON.parse(result.trim());
    console.log('Edge detection result:', data);
    return data.gap_x > 0 ? data.gap_x : null;
  } catch (e: any) {
    console.log('Edge detection error:', e.message);
    return null;
  }
}

async function main() {
  console.log('=== GeeTest Slider (Edge Detection) ===\n');
  
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    await page.goto('https://nopecha.com/captcha/geetest#slide', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Click verify
    console.log('Clicking verify...');
    await page.locator('[class*="geetest_btn_click"]').first().click();
    await page.waitForSelector('text="Slide to complete the puzzle"', { timeout: 10000 });
    await page.waitForTimeout(1500);
    
    // Get the background and slice images
    const bgElement = page.locator('[class*="geetest_bg"]').first();
    const sliceElement = page.locator('[class*="geetest_slice_bg"]').first();
    
    const bgPath = '/tmp/geetest-bg.png';
    const slicePath = '/tmp/geetest-slice.png';
    
    await bgElement.screenshot({ path: bgPath });
    await sliceElement.screenshot({ path: slicePath });
    console.log('Images saved');
    
    // Find gap using edge detection
    console.log('\nFinding gap with edge detection...');
    const gapX = await findGapWithEdgeDetection(bgPath, slicePath);
    
    if (gapX === null) {
      console.log('Could not detect gap');
      return;
    }
    
    console.log(`Gap at x=${gapX}`);
    
    // Get slider button position
    const sliderBtn = page.locator('[class*="geetest_btn"]').first();
    const sliderBox = await sliderBtn.boundingBox();
    
    if (!sliderBox) {
      console.log('Could not find slider');
      return;
    }
    
    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;
    const dragDistance = gapX;
    
    console.log(`\nDragging ${dragDistance}px...`);
    
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(50);
    
    // Human-like drag
    const steps = 35;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = startX + dragDistance * eased;
      const wobbleY = (Math.random() - 0.5) * 2;
      const wobbleX = (Math.random() - 0.5) * 1;
      await page.mouse.move(x + wobbleX, startY + wobbleY);
      await page.waitForTimeout(8 + Math.random() * 12);
    }
    
    await page.waitForTimeout(100);
    await page.mouse.up();
    
    // Wait for result
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/geetest-result.png' });
    
    // Check success
    const pageText = await page.locator('body').textContent();
    if (pageText?.includes('success') || pageText?.includes('Success')) {
      console.log('\n✅ SOLVED!');
    } else {
      console.log('\n❌ Check result screenshot');
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/tmp/geetest-error.png' }).catch(() => {});
  }
  
  await page.close();
  await context.close();
}

main().catch(console.error);
