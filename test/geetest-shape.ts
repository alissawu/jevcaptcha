import { chromium } from 'playwright';
import * as fs from 'fs';
import { execSync } from 'child_process';

const SHAPE_DETECT_PY = `
import cv2
import numpy as np
import sys
import json

bg = cv2.imread(sys.argv[1])
slice_img = cv2.imread(sys.argv[2], cv2.IMREAD_UNCHANGED)
bg_gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)

# Get piece shape from alpha
alpha = slice_img[:, :, 3]
mask = (alpha > 128).astype(np.uint8) * 255
contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
largest = max(contours, key=cv2.contourArea)
px, py, pw, ph = cv2.boundingRect(largest)

# Create boundary template
piece_mask = mask[py:py+ph, px:px+pw]
kernel = np.ones((3,3), np.uint8)
inner = cv2.erode(piece_mask, kernel, iterations=2)
boundary = piece_mask - inner

# Edge detect background
bg_edges = cv2.Canny(bg_gray, 30, 100)

# Scan for boundary match
best = {'x': 0, 'score': 0}
for test_x in range(5, bg.shape[1] - pw - 5, 2):
    for test_y in range(5, bg.shape[0] - ph - 5, 2):
        window = bg_edges[test_y:test_y+ph, test_x:test_x+pw]
        if window.shape != boundary.shape:
            continue
        
        boundary_pixels = boundary > 0
        matches = np.sum((window > 0) & boundary_pixels)
        total = np.sum(boundary_pixels)
        
        bg_window = bg_gray[test_y:test_y+ph, test_x:test_x+pw]
        inner_mask = inner > 0
        brightness = np.mean(bg_window[inner_mask]) if np.any(inner_mask) else 255
        
        score = (matches / total if total > 0 else 0) + max(0, (150 - brightness) / 150) * 0.3
        
        if score > best['score']:
            best = {'x': test_x, 'y': test_y, 'score': score}

print(json.dumps({'gap_x': best['x'], 'offset_x': px, 'confidence': best['score']}))
`;

async function detectGap(bgPath: string, slicePath: string) {
  const pyPath = '/tmp/shape_detect.py';
  fs.writeFileSync(pyPath, SHAPE_DETECT_PY);
  
  const output = execSync(`/opt/hako/packages/python/3.14.4/bin/python3 ${pyPath} ${bgPath} ${slicePath}`).toString();
  return JSON.parse(output);
}

async function main() {
  console.log('=== GeeTest Slider (Shape Matching) ===\n');
  
  const browser = await chromium.connectOverCDP('https://showman-handshake-unselfish.ngrok-free.dev');
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  
  if (!page) {
    console.log('No page found');
    return;
  }
  
  console.log('Connected\n');
  
  try {
    console.log('Clicking verify...');
    await page.locator('[class*="geetest_btn_click"]').first().click();
    await page.waitForSelector('text=Slide to complete the puzzle', { timeout: 10000 });
    await page.waitForTimeout(800);
    
    console.log('Downloading images...');
    const bgEl = page.locator('[class*="geetest_bg"]').first();
    const sliceEl = page.locator('[class*="geetest_slice_bg"]').first();
    
    const bgSrc = await bgEl.getAttribute('src');
    const sliceSrc = await sliceEl.getAttribute('src');
    
    const [bgData, sliceData] = await Promise.all([
      page.evaluate(async (src: string) => {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        return Array.from(new Uint8Array(buf));
      }, bgSrc!),
      page.evaluate(async (src: string) => {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        return Array.from(new Uint8Array(buf));
      }, sliceSrc!)
    ]);
    
    fs.writeFileSync('/tmp/geetest-bg-dl.png', Buffer.from(bgData));
    fs.writeFileSync('/tmp/geetest-slice-dl.png', Buffer.from(sliceData));
    
    console.log('Detecting gap with shape matching...');
    const result = await detectGap('/tmp/geetest-bg-dl.png', '/tmp/geetest-slice-dl.png');
    
    console.log(`Gap at x=${result.gap_x}, offset=${result.offset_x}, conf=${result.confidence.toFixed(3)}`);
    
    const dragDistance = result.gap_x - result.offset_x;
    console.log(`Drag distance: ${dragDistance}px`);
    
    const sliderBtn = page.locator('[class*="geetest_btn"]:not([class*="click"])').first();
    const sliderBox = await sliderBtn.boundingBox();
    
    if (!sliderBox) {
      console.log('No slider found');
      return;
    }
    
    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;
    
    console.log(`\nDragging from (${startX.toFixed(0)}, ${startY.toFixed(0)}) by ${dragDistance}px...`);
    
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(80);
    await page.mouse.down();
    await page.waitForTimeout(40);
    
    // Human-like drag with ease-out
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = 1 - Math.pow(1 - t, 3);
      const x = startX + dragDistance * eased;
      const wobble = (Math.random() - 0.5) * 2;
      await page.mouse.move(x, startY + wobble);
      await page.waitForTimeout(8 + Math.random() * 12);
    }
    
    await page.waitForTimeout(80);
    await page.mouse.up();
    
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/geetest-result.png' });
    
    const text = await page.locator('body').textContent();
    if (text?.toLowerCase().includes('success')) {
      console.log('\n✅ SOLVED!');
    } else {
      console.log('\n❌ Check /tmp/geetest-result.png');
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
    await page.screenshot({ path: '/tmp/geetest-error.png' }).catch(() => {});
  }
}

main();
