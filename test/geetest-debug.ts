/**
 * Debug GeeTest structure
 */

import { chromium } from 'patchright';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';

async function main() {
  console.log('=== GeeTest Debug ===\n');
  
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://nopecha.com/captcha/geetest#slide', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Click verify
  await page.locator('[class*="geetest_btn_click"]').first().click();
  await page.waitForSelector('text="Slide to complete the puzzle"', { timeout: 10000 });
  await page.waitForTimeout(1500);
  
  // Screenshot the whole window
  const window = page.locator('[class*="geetest_window"]').first();
  await window.screenshot({ path: '/tmp/geetest-window.png' });
  console.log('Window screenshot saved');
  
  // Screenshot the slice (puzzle piece)
  const slice = page.locator('[class*="geetest_slice"]').first();
  await slice.screenshot({ path: '/tmp/geetest-slice.png' });
  console.log('Slice screenshot saved');
  
  // Get the slice background image
  const sliceStyle = await page.evaluate(() => {
    const slice = document.querySelector('[class*="geetest_slice_bg"]') as HTMLElement;
    if (slice) {
      return {
        backgroundImage: slice.style.backgroundImage || getComputedStyle(slice).backgroundImage,
        transform: slice.style.transform,
        left: slice.style.left,
        top: slice.style.top
      };
    }
    return null;
  });
  console.log('Slice style:', sliceStyle);
  
  // Get the bg image source
  const bgStyle = await page.evaluate(() => {
    const bg = document.querySelector('[class*="geetest_bg"]') as HTMLElement;
    if (bg) {
      return {
        backgroundImage: bg.style.backgroundImage || getComputedStyle(bg).backgroundImage,
        width: bg.offsetWidth,
        height: bg.offsetHeight
      };
    }
    return null;
  });
  console.log('Background style:', bgStyle);
  
  // Check for canvas elements
  const canvases = await page.evaluate(() => {
    const els = document.querySelectorAll('canvas');
    return Array.from(els).map(c => ({
      id: c.id,
      class: c.className,
      width: c.width,
      height: c.height,
      rect: c.getBoundingClientRect()
    }));
  });
  console.log('Canvases:', canvases);
  
  await page.close();
  await context.close();
}

main().catch(console.error);
