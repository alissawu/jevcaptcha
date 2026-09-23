import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const OPENROUTER_KEY = "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";

async function detectGapWithVision(bgPath: string, slicePath: string): Promise<{gapX: number, offsetX: number}> {
  // Get piece offset from slice
  const pyCode = `
import cv2
import numpy as np
import sys
slice_img = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
alpha = slice_img[:, :, 3]
mask = (alpha > 128).astype(np.uint8)
contours, _ = cv2.findContours(mask * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
largest = max(contours, key=cv2.contourArea)
x, y, w, h = cv2.boundingRect(largest)
print(x)
`;
  const pyPath = '/tmp/get_offset.py';
  fs.writeFileSync(pyPath, pyCode);
  const { execSync } = require('child_process');
  const offsetX = parseInt(execSync(`/opt/hako/packages/python/3.14.4/bin/python3 ${pyPath} ${slicePath}`).toString().trim());
  
  // Read image and encode
  const imgData = fs.readFileSync(bgPath);
  const b64 = imgData.toString('base64');
  
  // Call vision API
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-3.5-flash-lite',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: 'This 300px wide image has a puzzle-piece shaped dark gap/shadow. What x-coordinate (0-300) is its center? Reply with just the number.' }
        ]
      }],
      max_tokens: 20
    })
  });
  
  const result = await resp.json() as any;
  const content = result.choices?.[0]?.message?.content || '150';
  const gapX = parseInt(content.match(/\d+/)?.[0] || '150');
  
  console.log(`Vision API: gap at x=${gapX}`);
  return { gapX, offsetX };
}

async function main() {
  console.log('=== GeeTest Slider (Vision API) ===\n');
  
  const browser = await chromium.connectOverCDP('https://showman-handshake-unselfish.ngrok-free.dev');
  const contexts = browser.contexts();
  const context = contexts[0];
  const page = context?.pages()[0];
  
  if (!page) {
    console.log('No page found');
    return;
  }
  
  console.log('Connected\n');
  
  try {
    // Click verify button
    console.log('Clicking verify...');
    const verifyBtn = page.locator('[class*="geetest_btn_click"]').first();
    await verifyBtn.click();
    
    // Wait for captcha
    await page.waitForSelector('text=Slide to complete the puzzle', { timeout: 10000 });
    await page.waitForTimeout(1000);
    
    // Download images
    console.log('Downloading images...');
    const bgEl = page.locator('[class*="geetest_bg"]').first();
    const sliceEl = page.locator('[class*="geetest_slice_bg"]').first();
    
    const bgSrc = await bgEl.getAttribute('src');
    const sliceSrc = await sliceEl.getAttribute('src');
    
    if (!bgSrc || !sliceSrc) {
      console.log('Could not get image sources');
      return;
    }
    
    // Download via page context
    const [bgData, sliceData] = await Promise.all([
      page.evaluate(async (src: string) => {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        return Array.from(new Uint8Array(buf));
      }, bgSrc),
      page.evaluate(async (src: string) => {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        return Array.from(new Uint8Array(buf));
      }, sliceSrc)
    ]);
    
    fs.writeFileSync('/tmp/geetest-bg-dl.png', Buffer.from(bgData));
    fs.writeFileSync('/tmp/geetest-slice-dl.png', Buffer.from(sliceData));
    
    // Detect gap with vision
    console.log('Detecting gap with vision...');
    const { gapX, offsetX } = await detectGapWithVision('/tmp/geetest-bg-dl.png', '/tmp/geetest-slice-dl.png');
    
    const dragDistance = gapX - offsetX;
    console.log(`Gap at x=${gapX}, offset=${offsetX}, drag=${dragDistance}px`);
    
    // Get slider
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
    
    // Human-like drag
    const steps = 35;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = startX + dragDistance * eased;
      const wobbleY = (Math.random() - 0.5) * 2;
      await page.mouse.move(x, startY + wobbleY);
      await page.waitForTimeout(10 + Math.random() * 15);
    }
    
    await page.waitForTimeout(100);
    await page.mouse.up();
    
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/tmp/geetest-result.png' });
    
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

main();
