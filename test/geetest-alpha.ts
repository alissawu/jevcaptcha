/**
 * GeeTest slider with alpha-based gap detection
 */

import { chromium } from 'patchright';
import { execSync } from 'child_process';
import * as fs from 'fs';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';

const GAP_DETECT_PY = `
import cv2
import numpy as np
import sys
import json

def find_gap(bg_path, slice_path):
    bg = cv2.imread(bg_path)
    slice_img = cv2.imread(slice_path, cv2.IMREAD_UNCHANGED)
    
    if bg is None or slice_img is None:
        return {"gap_x": -1, "offset_x": 0}
    
    if slice_img.shape[2] != 4:
        return {"gap_x": -1, "offset_x": 0}
    
    alpha = slice_img[:, :, 3]
    mask = (alpha > 128).astype(np.uint8)
    
    contours, _ = cv2.findContours(mask * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"gap_x": -1, "offset_x": 0}
    
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    offset_x = x
    
    piece_mask = mask[y:y+h, x:x+w]
    
    # Create boundary-only mask
    dilated = cv2.dilate(piece_mask * 255, np.ones((3,3), np.uint8))
    eroded = cv2.erode(piece_mask * 255, np.ones((3,3), np.uint8))
    boundary = (dilated - eroded).astype(np.uint8)
    
    # Get Canny edges
    bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    bg_canny = cv2.Canny(bg_gray, 50, 150)
    
    # Scan and score
    best_score = float('-inf')
    best_x = 0
    best_y = 0
    
    for test_x in range(5, bg.shape[1] - w - 5):
        for test_y in range(5, bg.shape[0] - h - 5):
            window = bg_canny[test_y:test_y+h, test_x:test_x+w]
            
            if window.shape != boundary.shape:
                continue
            
            # Count edge pixels along boundary
            matches = np.sum((window > 0) & (boundary > 0))
            total_boundary = np.sum(boundary > 0)
            
            # Penalize edges inside the piece
            inner = (piece_mask > 0) & (boundary == 0)
            inner_edges = np.sum((window > 0) & inner)
            
            score = matches / total_boundary - inner_edges / (np.sum(inner) + 1) * 0.3
            
            if score > best_score:
                best_score = score
                best_x = test_x
                best_y = test_y
    
    return {
        "gap_x": int(best_x),
        "offset_x": int(offset_x),
        "confidence": float(best_score)
    }

if __name__ == "__main__":
    result = find_gap(sys.argv[1], sys.argv[2])
    print(json.dumps(result))
`;

async function findGap(bgPath: string, slicePath: string): Promise<{gapX: number, offsetX: number, confidence: number} | null> {
  const pyPath = '/tmp/geetest_alpha_detect.py';
  fs.writeFileSync(pyPath, GAP_DETECT_PY);
  
  try {
    const result = execSync(`/opt/hako/packages/python/3.14.4/bin/python3 ${pyPath} ${bgPath} ${slicePath}`, { encoding: 'utf-8' });
    const data = JSON.parse(result.trim());
    if (data.gap_x < 0) return null;
    return { gapX: data.gap_x, offsetX: data.offset_x, confidence: data.confidence };
  } catch (e: any) {
    console.log('Detection error:', e.message);
    return null;
  }
}

async function main() {
  console.log('=== GeeTest Slider (Alpha Mask Detection) ===\n');
  
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
    
    console.log('Clicking verify...');
    await page.locator('[class*="geetest_btn_click"]').first().click();
    await page.waitForSelector('text="Slide to complete the puzzle"', { timeout: 10000 });
    await page.waitForTimeout(1500);
    
    // Get the actual image URLs from the DOM
    const bgUrl = await page.$eval('[class*="geetest_bg"]',
      (el: any) => window.getComputedStyle(el).backgroundImage.replace(/url\(["']?|["']?\)/g, ''));
    const sliceUrl = await page.$eval('[class*="geetest_slice_bg"]',
      (el: any) => window.getComputedStyle(el).backgroundImage.replace(/url\(["']?|["']?\)/g, ''));
    
    console.log('Downloading images...');
    
    // Download the actual images
    const bgPath = '/tmp/geetest-bg-dl.png';
    const slicePath = '/tmp/geetest-slice-dl.png';
    
    execSync(`curl -s "${bgUrl}" -o ${bgPath}`);
    execSync(`curl -s "${sliceUrl}" -o ${slicePath}`);
    
    // Find gap
    console.log('Detecting gap...');
    const result = await findGap(bgPath, slicePath);
    
    if (!result) {
      console.log('Could not detect gap');
      return;
    }
    
    console.log(`Gap at x=${result.gapX}, piece offset=${result.offsetX}, conf=${result.confidence.toFixed(3)}`);
    
    // Calculate drag distance
    // The slice starts at left=0, piece content is offset by offsetX inside
    // We need piece to reach gapX, so: drag = gapX - offsetX
    const dragDistance = result.gapX - result.offsetX;
    console.log(`Drag distance: ${dragDistance}px`);
    
    // Get slider button position
    const sliderBtn = page.locator('[class*="geetest_btn"]:not([class*="click"])').first();
    const sliderBox = await sliderBtn.boundingBox();
    
    if (!sliderBox) {
      console.log('Could not find slider');
      return;
    }
    
    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;
    
    console.log(`\nDragging from (${startX.toFixed(0)}, ${startY.toFixed(0)}) by ${dragDistance}px...`);
    
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(50);
    
    // Human-like drag with easing
    const steps = 40;
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
    
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/tmp/geetest-result.png' });
    
    // Check success
    const pageText = await page.locator('body').textContent();
    if (pageText?.includes('success') || pageText?.includes('Success') || pageText?.includes('验证成功')) {
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
