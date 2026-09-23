import { chromium } from 'patchright';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';

async function main() {
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://nopecha.com/captcha/geetest#slide', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  await page.locator('[class*="geetest_btn_click"]').first().click();
  await page.waitForSelector('text="Slide to complete the puzzle"', { timeout: 10000 });
  await page.waitForTimeout(1500);
  
  // Use $eval with string function
  const sliceTransform = await page.$eval('[class*="geetest_slice"]', 
    (el: any) => window.getComputedStyle(el).transform);
  const sliceLeft = await page.$eval('[class*="geetest_slice"]',
    (el: any) => window.getComputedStyle(el).left);
  const sliceBox = await page.locator('[class*="geetest_slice"]').first().boundingBox();
  
  const bgUrl = await page.$eval('[class*="geetest_bg"]',
    (el: any) => window.getComputedStyle(el).backgroundImage);
  const sliceBgUrl = await page.$eval('[class*="geetest_slice_bg"]',
    (el: any) => window.getComputedStyle(el).backgroundImage);
    
  console.log('Slice transform:', sliceTransform);
  console.log('Slice left:', sliceLeft);
  console.log('Slice box:', sliceBox);
  console.log('BG URL:', bgUrl?.slice(0, 150));
  console.log('SliceBG URL:', sliceBgUrl?.slice(0, 150));
  
  await page.close();
  await context.close();
}

main().catch(console.error);
