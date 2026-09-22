/**
 * Capture a captcha from hCaptcha demo for testing
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function captureHCaptcha() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // hCaptcha demo page
  await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'networkidle' });
  
  // Click the checkbox to trigger the challenge
  const checkbox = page.frameLocator('iframe[title="Widget containing checkbox for hCaptcha security challenge"]').locator('#checkbox');
  await checkbox.click();
  
  // Wait for challenge to appear
  await page.waitForTimeout(2000);
  
  // Find the challenge iframe
  const challengeFrame = page.frameLocator('iframe[title="hCaptcha challenge"]');
  
  // Get the challenge prompt
  const promptEl = challengeFrame.locator('.prompt-text');
  const prompt = await promptEl.textContent().catch(() => 'Unknown prompt');
  console.log('Prompt:', prompt);
  
  // Try different challenge selectors
  const selectors = [
    '.task-image',      // grid challenges
    '.task-grid',       // alternative grid
    '.challenge-view',  // general challenge area
    '.display-language-picker ~ div', // fallback
  ];
  
  let saved = false;
  for (const sel of selectors) {
    const el = challengeFrame.locator(sel).first();
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 100) {
      const screenshot = await page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      const outPath = path.join(import.meta.dirname, 'fixtures', `hcaptcha_${sel.replace(/[^a-z]/g, '')}.png`);
      fs.writeFileSync(outPath, screenshot);
      console.log(`Saved ${sel}: ${outPath} (${box.width}x${box.height})`);
      saved = true;
      break;
    }
  }
  
  if (!saved) {
    // Fallback: screenshot the whole challenge iframe
    const screenshot = await page.screenshot({ fullPage: true });
    const outPath = path.join(import.meta.dirname, 'fixtures', 'hcaptcha_full.png');
    fs.writeFileSync(outPath, screenshot);
    console.log(`Saved full page: ${outPath}`);
  }
  
  await browser.close();
}

captureHCaptcha().catch(console.error);
