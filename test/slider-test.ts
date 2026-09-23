/**
 * Test slider captcha on SmartRecruiters
 */

import { chromium } from 'patchright';
import { solveSlider } from '../src/solvers/slider.js';

const NGROK_URL = 'https://showman-handshake-unselfish.ngrok-free.dev';

// SmartRecruiters-specific selectors
const SMARTRECRUITERS_SELECTORS = {
  handle: '.nc_iconfont.btn_slide',
  track: '.nc-container',
  success: '.nc_iconfont.icon_ok',
};

async function main() {
  console.log('=== Slider Captcha Test ===\n');
  console.log('Connecting to Chrome via CDP...');
  
  const versionRes = await fetch(`${NGROK_URL}/json/version`);
  const version = await versionRes.json() as any;
  let wsUrl = version.webSocketDebuggerUrl;
  wsUrl = wsUrl.replace('ws://127.0.0.1:9224', NGROK_URL.replace('https://', 'wss://'));
  
  const browser = await chromium.connectOverCDP(wsUrl);
  console.log('Connected!\n');
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Find a SmartRecruiters job posting
    console.log('Going to SmartRecruiters job page...');
    await page.goto('https://jobs.smartrecruiters.com/BoschGroup/744000149236759--internship-program-q4-embedded-software-intern-c-c-linux-', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    // Check if there's an apply button
    const applyBtn = page.locator('button:has-text("Apply"), a:has-text("Apply")').first();
    const hasApply = await applyBtn.count();
    
    if (hasApply > 0) {
      console.log('Found Apply button, clicking...');
      await applyBtn.click();
      await page.waitForTimeout(3000);
    }
    
    // Look for slider
    console.log('Looking for slider captcha...');
    const sliderHandle = page.locator('.nc_iconfont.btn_slide, [class*="slider"], [class*="slide-btn"]').first();
    const hasSlider = await sliderHandle.count();
    
    if (hasSlider > 0) {
      console.log('Found slider, attempting to solve...');
      const result = await solveSlider(page, SMARTRECRUITERS_SELECTORS, { humanize: true });
      
      if (result.success) {
        console.log(`✅ Slider solved in ${result.duration}ms`);
      } else {
        console.log(`❌ Slider failed: ${result.error}`);
      }
    } else {
      console.log('No slider found on this page');
      
      // Screenshot to see what's there
      await page.screenshot({ path: '/tmp/smartrecruiters-page.png' });
      console.log('Screenshot saved to /tmp/smartrecruiters-page.png');
      
      // List what elements are on the page
      const pageContent = await page.content();
      if (pageContent.includes('slider') || pageContent.includes('slide')) {
        console.log('Page contains slider-related text but element not found');
      }
    }
    
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  
  await page.close();
  await context.close();
}

main().catch(console.error);
